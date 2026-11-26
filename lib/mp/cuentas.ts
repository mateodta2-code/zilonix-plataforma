import { and, asc, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMp } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { renovarToken, type TokensMp } from "@/lib/mp/oauth";

// Issue #422 (Bloque 1) — mismo molde que lib/ml/cuentas.ts. Los tokens
// se cifran con cifrarToken (clave ML_TOKEN_KEY_Vn, igual que Canva en
// lib/canva/conexiones.ts) para no pedir otra variable en Railway.

const SEGUNDOS_DE_MARGEN = 120; // renovar un poco antes de que venza
const CANDADO_ABANDONADO_MS = 30_000; // un candado de más de 30s se considera caído

function expiraTsDesdeAhora(tokens: TokensMp): Date {
  return new Date(Date.now() + (tokens.expiraEnSegundos - SEGUNDOS_DE_MARGEN) * 1000);
}

export class CuentaMpDeOtraEmpresaError extends Error {
  constructor() {
    // Nunca revela A QUÉ empresa pertenece.
    super("Esta cuenta de Mercado Pago ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.");
    this.name = "CuentaMpDeOtraEmpresaError";
  }
}

export class CuentaMpNoEncontradaError extends Error {
  constructor() {
    super("No se encontró esa cuenta de Mercado Pago.");
    this.name = "CuentaMpNoEncontradaError";
  }
}

export class CuentaMpDesconectadaError extends Error {
  constructor() {
    super("Esta cuenta de Mercado Pago está desconectada — hay que reconectarla.");
    this.name = "CuentaMpDesconectadaError";
  }
}

export class CandadoRenovacionMpError extends Error {
  constructor() {
    super("Otro proceso ya está renovando el token de esta cuenta de Mercado Pago — reintentar en unos segundos.");
    this.name = "CandadoRenovacionMpError";
  }
}

export class RenovacionTokenMpFallidaError extends Error {
  constructor() {
    super("No se pudo renovar la conexión con Mercado Pago — puede que haya que reconectar la cuenta.");
    this.name = "RenovacionTokenMpFallidaError";
  }
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

// Mismo caso real que lib/ml/cuentas.ts (Postgres 16.16+): el choque con
// una fila de OTRA empresa bajo RLS a FORCE sale como 42501 en vez de
// 23505. Acotado a este mensaje y a esta tabla.
function esChoqueRlsConFilaAjena(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42501") return false;
  const mensaje = "message" in error && typeof error.message === "string" ? error.message : "";
  return mensaje.includes("row-level security policy") && mensaje.includes("cuentas_mp");
}

// INSERT ... ON CONFLICT (cuenta_id_externa) DO UPDATE ... WHERE
// empresa_id = la empresa actual: reconectar la misma cuenta en la misma
// empresa reactiva la MISMA fila; si la fila es de otra empresa, nada se
// aplica y se lanza CuentaMpDeOtraEmpresaError.
export async function guardarCuentaMpConectada(
  empresaId: string,
  datos: { cuentaIdExterna: string; nickname: string | null; tokens: TokensMp }
): Promise<{ id: string }> {
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const [fila] = await tx
        .insert(cuentasMp)
        .values({
          empresaId,
          cuentaIdExterna: datos.cuentaIdExterna,
          nickname: datos.nickname,
          accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
          refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
          tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
        })
        .onConflictDoUpdate({
          target: cuentasMp.cuentaIdExterna,
          set: {
            // Si /users/me no respondió esta vez, no se pisa un nickname
            // real que ya estaba guardado.
            ...(datos.nickname ? { nickname: datos.nickname } : {}),
            accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
            refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
            tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
            desconectadaTs: null,
            renovandoTs: null,
          },
          setWhere: eq(cuentasMp.empresaId, empresaId),
        })
        .returning({ id: cuentasMp.id });

      if (!fila) throw new CuentaMpDeOtraEmpresaError();
      return fila;
    });
  } catch (error) {
    if (error instanceof CuentaMpDeOtraEmpresaError) throw error;
    if (esViolacionDeUnicidad(error) || esChoqueRlsConFilaAjena(error)) throw new CuentaMpDeOtraEmpresaError();
    throw error;
  }
}

export async function listarCuentasMpConectadas(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMp.id,
        cuentaIdExterna: cuentasMp.cuentaIdExterna,
        nickname: cuentasMp.nickname,
        desconectadaTs: cuentasMp.desconectadaTs,
        creadoTs: cuentasMp.creadoTs,
      })
      .from(cuentasMp)
      .where(eq(cuentasMp.empresaId, empresaId))
  );
}

// Solo las cuentas activas (sin desconectada_ts). listarCuentasMpConectadas
// sigue devolviendo también las desconectadas porque /panel/conectar-ml
// las muestra con el chip «Desconectada».
export async function listarCuentasMpActivas(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMp.id,
        cuentaIdExterna: cuentasMp.cuentaIdExterna,
        nickname: cuentasMp.nickname,
      })
      .from(cuentasMp)
      .where(and(eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs)))
      .orderBy(asc(cuentasMp.creadoTs))
  );
}

type PasoToken = { tipo: "vigente"; accessToken: string } | { tipo: "renovar"; refreshToken: string; candado: Date };

// Devuelve un access_token vigente, renovando primero si ya venció o
// está por vencer (120s de margen).
//
// Bloque 2 — renovación concurrente: Mercado Pago rota el refresh_token
// en cada renovación, así que dos procesos renovando a la vez dejaban
// uno con un refresh_token ya usado. Ahora:
//   1. Transacción corta con SELECT ... FOR UPDATE: un segundo proceso
//      espera el candado de fila y, al seguir, RELEE token_expira_ts,
//      refresh_token y renovando_ts ya actualizados. Si otro proceso ya
//      renovó, devuelve ese token fresco; si está renovando, lanza
//      CandadoRenovacionMpError. Si no, marca renovando_ts y confirma.
//   2. El fetch a Mercado Pago va FUERA de cualquier transacción.
//   3. Transacción corta para guardar los tokens nuevos, solo si el
//      candado sigue siendo el nuestro (una reconexión en el medio lo
//      limpia y gana la reconexión).
// empresa_id explícito en cada consulta, además de la RLS.
export async function obtenerAccessTokenMpVigente(empresaId: string, cuentaId: string): Promise<string> {
  const deEstaCuenta = and(eq(cuentasMp.id, cuentaId), eq(cuentasMp.empresaId, empresaId));

  const paso = await dbComoEmpresa(empresaId, async (tx): Promise<PasoToken> => {
    const [cuenta] = await tx.select().from(cuentasMp).where(deEstaCuenta).for("update");
    if (!cuenta) throw new CuentaMpNoEncontradaError();
    if (cuenta.desconectadaTs) throw new CuentaMpDesconectadaError();

    if (cuenta.tokenExpiraTs.getTime() > Date.now()) {
      return { tipo: "vigente", accessToken: descifrarToken(cuenta.accessTokenCifrado) };
    }

    const umbralCandadoCaido = Date.now() - CANDADO_ABANDONADO_MS;
    if (cuenta.renovandoTs && cuenta.renovandoTs.getTime() >= umbralCandadoCaido) throw new CandadoRenovacionMpError();

    const candado = new Date();
    await tx.update(cuentasMp).set({ renovandoTs: candado }).where(deEstaCuenta);
    return { tipo: "renovar", refreshToken: descifrarToken(cuenta.refreshTokenCifrado), candado };
  });

  if (paso.tipo === "vigente") return paso.accessToken;

  const conNuestroCandado = and(deEstaCuenta, eq(cuentasMp.renovandoTs, paso.candado));
  let tokensNuevos: TokensMp;
  try {
    tokensNuevos = await renovarToken(paso.refreshToken);
  } catch (error) {
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMp).set({ renovandoTs: null }).where(conNuestroCandado));
    // Solo el nombre del error, nunca error.message (puede traer texto
    // crudo de Mercado Pago, ver lib/mp/oauth.ts).
    console.warn(`[lib/mp/cuentas] no se pudo renovar el token de la cuenta ${cuentaId}:`, error instanceof Error ? error.name : String(error));
    throw new RenovacionTokenMpFallidaError();
  }

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(cuentasMp)
      .set({
        accessTokenCifrado: cifrarToken(tokensNuevos.accessToken),
        refreshTokenCifrado: cifrarToken(tokensNuevos.refreshToken),
        tokenExpiraTs: expiraTsDesdeAhora(tokensNuevos),
        renovandoTs: null,
      })
      .where(conNuestroCandado)
  );
  return tokensNuevos.accessToken;
}

// Desconectar nunca borra la fila — solo marca desconectada_ts — y deja
// rastro en la auditoría, en la misma transacción.
export async function desconectarCuentaMp(empresaId: string, cuentaId: string, usuarioId: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .update(cuentasMp)
      .set({ desconectadaTs: new Date() })
      .where(and(eq(cuentasMp.id, cuentaId), eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs)))
      .returning({ id: cuentasMp.id, nickname: cuentasMp.nickname, cuentaIdExterna: cuentasMp.cuentaIdExterna });
    if (!fila) return;
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "eliminar",
      entidad: "cuenta_mp",
      entidadId: fila.id,
      detalle: `Desconectó la cuenta de Mercado Pago ${fila.nickname ?? fila.cuentaIdExterna}.`,
    });
  });
}
