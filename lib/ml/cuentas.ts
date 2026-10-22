import { and, eq, isNull, lt, or } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { renovarToken, type TokensMl } from "@/lib/ml/oauth";

const SEGUNDOS_DE_MARGEN = 120; // renovar un poco antes de que venza, no justo al filo
const CANDADO_ABANDONADO_MS = 30_000; // tarea 2.3: un candado de más de 30s se considera caído, se puede retomar

function expiraTsDesdeAhora(tokens: TokensMl): Date {
  return new Date(Date.now() + (tokens.expiraEnSegundos - SEGUNDOS_DE_MARGEN) * 1000);
}

export async function guardarCuentaConectada(
  empresaId: string,
  datos: { cuentaIdExterna: string; nickname: string; tokens: TokensMl }
): Promise<{ id: string }> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: datos.cuentaIdExterna,
        nickname: datos.nickname,
        accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
        refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
        tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
      })
      .returning({ id: cuentasMl.id });
    return fila;
  });
}

export class CandadoDeRenovacionError extends Error {
  constructor() {
    super("Otro proceso ya está renovando el token de esta cuenta — reintentar en unos segundos.");
    this.name = "CandadoDeRenovacionError";
  }
}

// Devuelve un access_token vigente, renovando primero si ya venció o
// está por vencer. Candado contra renovaciones dobles (tarea 2.3: el
// refresh_token de Mercado Libre sirve una sola vez, dos renovaciones a
// la vez desconectan la cuenta de verdad) — se toma con un UPDATE
// atómico (gana quien lo escribe primero, Postgres lo serializa solo)
// antes de llamar a Mercado Libre, nunca con un SELECT-y-luego-UPDATE
// separados que dejarían una ventana para que dos procesos pasen juntos.
export async function obtenerAccessTokenVigente(empresaId: string, cuentaId: string): Promise<string> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [cuenta] = await tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaId));
    if (!cuenta) throw new Error(`Cuenta de Mercado Libre no encontrada: ${cuentaId}`);
    if (cuenta.desconectadaTs) throw new Error("Esta cuenta está desconectada.");

    if (cuenta.tokenExpiraTs.getTime() > Date.now()) {
      return descifrarToken(cuenta.accessTokenCifrado);
    }

    const umbralCandadoCaido = new Date(Date.now() - CANDADO_ABANDONADO_MS);
    const [candadoTomado] = await tx
      .update(cuentasMl)
      .set({ renovandoTs: new Date() })
      .where(and(eq(cuentasMl.id, cuentaId), or(isNull(cuentasMl.renovandoTs), lt(cuentasMl.renovandoTs, umbralCandadoCaido))))
      .returning({ id: cuentasMl.id });

    if (!candadoTomado) {
      throw new CandadoDeRenovacionError();
    }

    try {
      const refreshToken = descifrarToken(cuenta.refreshTokenCifrado);
      const tokensNuevos = await renovarToken(refreshToken);
      await tx
        .update(cuentasMl)
        .set({
          accessTokenCifrado: cifrarToken(tokensNuevos.accessToken),
          refreshTokenCifrado: cifrarToken(tokensNuevos.refreshToken),
          tokenExpiraTs: expiraTsDesdeAhora(tokensNuevos),
          renovandoTs: null,
        })
        .where(eq(cuentasMl.id, cuentaId));
      return tokensNuevos.accessToken;
    } catch (error) {
      // Libera el candado aunque falle — si no, nadie puede volver a
      // intentar hasta que pasen los 30s de "candado caído" de arriba.
      await tx.update(cuentasMl).set({ renovandoTs: null }).where(eq(cuentasMl.id, cuentaId));
      throw error;
    }
  });
}

// Desconectar nunca borra la fila ni el histórico que ya se importó
// (evidencia real de UpSeller, tarea 2.3) — solo marca `desconectadaTs`.
export async function desconectarCuenta(empresaId: string, cuentaId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.update(cuentasMl).set({ desconectadaTs: new Date() }).where(eq(cuentasMl.id, cuentaId))
  );
}

// Issue #54 (Z-MT-08) — lo único que necesita <SelectorCuentaMl/>
// (components/SelectorCuentaMl.tsx): id y apodo de las cuentas
// conectadas de la empresa activa, nunca tokens ni otro dato sensible.
// Misma conexión que respeta RLS (dbComoEmpresa) que ya usa
// listarCuentasConectadas() — nunca el superusuario.
export async function listarCuentasMlParaSelector(empresaId: string): Promise<{ id: string; apodo: string }[]> {
  const cuentas = await listarCuentasConectadas(empresaId);
  return cuentas.filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, apodo: c.nickname }));
}

export async function listarCuentasConectadas(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMl.id,
        cuentaIdExterna: cuentasMl.cuentaIdExterna,
        nickname: cuentasMl.nickname,
        desconectadaTs: cuentasMl.desconectadaTs,
        creadoTs: cuentasMl.creadoTs,
      })
      .from(cuentasMl)
  );
}
