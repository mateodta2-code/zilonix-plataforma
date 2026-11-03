import { and, eq, isNull, lt, or } from "drizzle-orm";
import { dbComoEmpresaYUsuario } from "@/db/empresa-context";
import { canvaConexiones } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { renovarToken, revocarTokenSiEsPosible, type TokensCanva } from "./oauth";

const SEGUNDOS_DE_MARGEN = 120; // mismo margen que lib/ml/cuentas.ts — renovar un poco antes de que venza
const CANDADO_ABANDONADO_MS = 30_000;

function expiraTsDesdeAhora(tokens: TokensCanva): Date {
  return new Date(Date.now() + (tokens.expiraEnSegundos - SEGUNDOS_DE_MARGEN) * 1000);
}

export class ConexionCanvaNoEncontradaError extends Error {
  constructor() {
    super("No hay una conexión de Canva para este usuario en esta empresa.");
    this.name = "ConexionCanvaNoEncontradaError";
  }
}

export class ConexionCanvaDesconectadaError extends Error {
  constructor() {
    super("Conecta tu Canva para traer el diseño.");
    this.name = "ConexionCanvaDesconectadaError";
  }
}

export class CandadoDeRenovacionCanvaError extends Error {
  constructor() {
    super("Ya se está renovando la conexión con Canva — reintentá en unos segundos.");
    this.name = "CandadoDeRenovacionCanvaError";
  }
}

export class RenovacionTokenCanvaFallidaError extends Error {
  constructor() {
    super("No se pudo renovar la conexión con Canva — reconectá tu cuenta.");
    this.name = "RenovacionTokenCanvaFallidaError";
  }
}

// Primera conexión o reconexión: reactiva la MISMA fila (empresa_id +
// usuario_id es único — ver db/schema.ts) en vez de crear una segunda,
// mismo criterio que guardarCuentaConectada (lib/ml/cuentas.ts).
export async function guardarConexion(empresaId: string, usuarioId: string, tokens: TokensCanva): Promise<{ id: string }> {
  return dbComoEmpresaYUsuario(empresaId, usuarioId, async (tx) => {
    const [fila] = await tx
      .insert(canvaConexiones)
      .values({
        empresaId,
        usuarioId,
        accessTokenCifrado: cifrarToken(tokens.accessToken),
        refreshTokenCifrado: cifrarToken(tokens.refreshToken),
        tokenExpiraTs: expiraTsDesdeAhora(tokens),
      })
      .onConflictDoUpdate({
        target: [canvaConexiones.empresaId, canvaConexiones.usuarioId],
        set: {
          accessTokenCifrado: cifrarToken(tokens.accessToken),
          refreshTokenCifrado: cifrarToken(tokens.refreshToken),
          tokenExpiraTs: expiraTsDesdeAhora(tokens),
          desconectadaTs: null,
          renovandoTs: null,
        },
      })
      .returning({ id: canvaConexiones.id });
    return fila;
  });
}

export async function obtenerEstadoConexion(empresaId: string, usuarioId: string): Promise<{ conectado: boolean } > {
  return dbComoEmpresaYUsuario(empresaId, usuarioId, async (tx) => {
    const [fila] = await tx
      .select({ desconectadaTs: canvaConexiones.desconectadaTs })
      .from(canvaConexiones)
      .where(and(eq(canvaConexiones.empresaId, empresaId), eq(canvaConexiones.usuarioId, usuarioId)));
    return { conectado: Boolean(fila && !fila.desconectadaTs) };
  });
}

// Devuelve un access_token vigente, renovando primero si ya venció o
// está por vencer — mismo candado atómico anti-doble-renovación que
// obtenerAccessTokenVigente (lib/ml/cuentas.ts): el UPDATE condicional
// gana solo si nadie más tiene el candado tomado (o si quedó abandonado
// hace más de 30s).
export async function obtenerAccessTokenVigente(empresaId: string, usuarioId: string): Promise<string> {
  return dbComoEmpresaYUsuario(empresaId, usuarioId, async (tx) => {
    const [conexion] = await tx
      .select()
      .from(canvaConexiones)
      .where(and(eq(canvaConexiones.empresaId, empresaId), eq(canvaConexiones.usuarioId, usuarioId)));
    if (!conexion) throw new ConexionCanvaNoEncontradaError();
    if (conexion.desconectadaTs || !conexion.accessTokenCifrado || !conexion.refreshTokenCifrado || !conexion.tokenExpiraTs) {
      throw new ConexionCanvaDesconectadaError();
    }

    if (conexion.tokenExpiraTs.getTime() > Date.now()) {
      return descifrarToken(conexion.accessTokenCifrado);
    }

    const umbralCandadoCaido = new Date(Date.now() - CANDADO_ABANDONADO_MS);
    const [candadoTomado] = await tx
      .update(canvaConexiones)
      .set({ renovandoTs: new Date() })
      .where(
        and(
          eq(canvaConexiones.id, conexion.id),
          or(isNull(canvaConexiones.renovandoTs), lt(canvaConexiones.renovandoTs, umbralCandadoCaido))
        )
      )
      .returning({ id: canvaConexiones.id });

    if (!candadoTomado) throw new CandadoDeRenovacionCanvaError();

    try {
      const refreshToken = descifrarToken(conexion.refreshTokenCifrado);
      const tokensNuevos = await renovarToken(refreshToken);
      await tx
        .update(canvaConexiones)
        .set({
          accessTokenCifrado: cifrarToken(tokensNuevos.accessToken),
          refreshTokenCifrado: cifrarToken(tokensNuevos.refreshToken),
          tokenExpiraTs: expiraTsDesdeAhora(tokensNuevos),
          renovandoTs: null,
        })
        .where(eq(canvaConexiones.id, conexion.id));
      return tokensNuevos.accessToken;
    } catch (error) {
      await tx.update(canvaConexiones).set({ renovandoTs: null }).where(eq(canvaConexiones.id, conexion.id));
      console.warn(`[lib/canva/conexiones] no se pudo renovar el token de la conexión ${conexion.id}:`, error instanceof Error ? error.name : String(error));
      throw new RenovacionTokenCanvaFallidaError();
    }
  });
}

// Desconectar: marca desconectada_ts, BORRA los tokens cifrados (los
// deja en null — pedido explícito de Pablo/Mateo, a diferencia de
// cuentas_ml que solo marca la fecha) e intenta revocar en Canva. La
// fila nunca se borra (histórico de "hubo una conexión").
export async function desconectarConexion(empresaId: string, usuarioId: string): Promise<void> {
  await dbComoEmpresaYUsuario(empresaId, usuarioId, async (tx) => {
    const [conexion] = await tx
      .select({ refreshTokenCifrado: canvaConexiones.refreshTokenCifrado })
      .from(canvaConexiones)
      .where(and(eq(canvaConexiones.empresaId, empresaId), eq(canvaConexiones.usuarioId, usuarioId)));

    if (conexion?.refreshTokenCifrado) {
      // Best-effort — nunca bloquea la desconexión (ver revocarTokenSiEsPosible).
      await revocarTokenSiEsPosible(descifrarToken(conexion.refreshTokenCifrado));
    }

    await tx
      .update(canvaConexiones)
      .set({
        desconectadaTs: new Date(),
        accessTokenCifrado: null,
        refreshTokenCifrado: null,
        tokenExpiraTs: null,
        renovandoTs: null,
      })
      .where(and(eq(canvaConexiones.empresaId, empresaId), eq(canvaConexiones.usuarioId, usuarioId)));
  });
}
