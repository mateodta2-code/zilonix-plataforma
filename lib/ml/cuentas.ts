import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { dbComoAvisoWebhook, dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { renovarToken, type TokensMl } from "@/lib/ml/oauth";

const SEGUNDOS_DE_MARGEN = 120; // renovar un poco antes de que venza, no justo al filo
const CANDADO_ABANDONADO_MS = 30_000; // tarea 2.3: un candado de más de 30s se considera caído, se puede retomar

function expiraTsDesdeAhora(tokens: TokensMl): Date {
  return new Date(Date.now() + (tokens.expiraEnSegundos - SEGUNDOS_DE_MARGEN) * 1000);
}

// Issue #151 — una cuenta real de Mercado Libre no puede estar
// conectada a dos empresas de Zilonix a la vez (índice único global
// sobre cuenta_id_externa, db/schema.ts). Antes de esto no había forma
// de distinguir, desde el mensaje de error, "ya está en otra empresa"
// de un bug cualquiera.
export class CuentaMlEnOtraEmpresaError extends Error {
  constructor() {
    super("Esta cuenta de Mercado Libre ya está conectada a otra empresa.");
    this.name = "CuentaMlEnOtraEmpresaError";
  }
}

function esViolacionDeUnicidad(error: unknown): boolean {
  // 23505 = unique_violation de Postgres — mismo chequeo que ya usan
  // lib/invitaciones.ts, lib/ml/sku.ts y app/crear-empresa/actions.ts,
  // no se inventa un helper nuevo para esto.
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

// Issue #151, bug real en vivo (23-oct, cuenta ZILONIX en staging):
// reconectar una cuenta que YA tenía una fila (desconectada, o
// recién vuelta a autorizar sin haberse desconectado antes) hacía un
// INSERT simple y chocaba con el índice único global sobre
// cuenta_id_externa — el error llegaba crudo a /panel/conectar-ml.
// Peor: para cuando este INSERT falla, app/api/ml/callback/route.ts ya
// canjeó el `code` por tokens NUEVOS en Mercado Libre — ese refresh
// token se pierde si no se guarda, y Mercado Libre solo acepta el
// último refresh token por usuario+app (un reintento puede dejar sin
// token válido una conexión que SÍ estaba funcionando).
//
// Por RLS, dbComoEmpresa(empresaId, ...) nunca puede ver una fila de
// OTRA empresa — así que antes de decidir INSERT vs UPDATE hay que
// mirar sin ese filtro. Se resuelve con dbComoAvisoWebhook() (db/
// empresa-context.ts): el mismo patrón ya establecido en
// lib/ml/avisos.ts para "sé el cuenta_id_externa real, confirmado por
// Mercado Libre — eso solo ya me deja ver esa fila puntual, sea de
// quien sea". Dos transacciones separadas (una por contexto RLS
// distinto) dejan en teoría una ventana de carrera mínima entre el
// chequeo y el INSERT/UPDATE — el índice único de Postgres (23505) es
// el backstop real si esa carrera llega a pasar de verdad.
export async function guardarCuentaConectada(
  empresaId: string,
  datos: { cuentaIdExterna: string; nickname: string; tokens: TokensMl }
): Promise<{ id: string }> {
  const filas = await dbComoAvisoWebhook(datos.cuentaIdExterna, (tx) =>
    tx.select({ id: cuentasMl.id, empresaId: cuentasMl.empresaId }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, datos.cuentaIdExterna))
  );
  const existente = filas[0] ?? null;

  if (existente && existente.empresaId !== empresaId) {
    throw new CuentaMlEnOtraEmpresaError();
  }

  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      if (existente) {
        // Reconectar: la MISMA fila (mismo id), nunca una nueva — tokens
        // nuevos, nickname al día, se limpia desconectadaTs y cualquier
        // candado de renovación que hubiera quedado colgado.
        const [fila] = await tx
          .update(cuentasMl)
          .set({
            nickname: datos.nickname,
            accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
            refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
            tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
            desconectadaTs: null,
            renovandoTs: null,
          })
          .where(eq(cuentasMl.id, existente.id))
          .returning({ id: cuentasMl.id });
        return fila;
      }
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
  } catch (error) {
    if (esViolacionDeUnicidad(error)) throw new CuentaMlEnOtraEmpresaError();
    throw error;
  }
}

export class CandadoDeRenovacionError extends Error {
  constructor() {
    super("Otro proceso ya está renovando el token de esta cuenta — reintentar en unos segundos.");
    this.name = "CandadoDeRenovacionError";
  }
}

// Issue #147 — las 4 formas en que obtenerAccessTokenVigente podía
// fallar (cuenta no encontrada, cuenta desconectada, candado, y la
// renovación en sí fallando contra Mercado Libre) eran `throw new
// Error(...)` genéricos — ninguna página los atrapaba, así que
// cualquiera de los cuatro terminaba en "Application error" en vez de
// un mensaje claro con un link para reconectar. Candado ya era una
// clase propia (CandadoDeRenovacionError, arriba); se agregan las que
// faltaban para que cualquier pantalla las pueda distinguir sin
// adivinar por el texto del mensaje.
export class CuentaMlNoEncontradaError extends Error {
  constructor() {
    super("No se encontró esa cuenta de Mercado Libre.");
    this.name = "CuentaMlNoEncontradaError";
  }
}

export class CuentaDesconectadaError extends Error {
  constructor() {
    super("Esta cuenta de Mercado Libre está desconectada — hay que reconectarla.");
    this.name = "CuentaDesconectadaError";
  }
}

// La renovación en sí (refresh_token → access_token nuevo) puede
// fallar contra Mercado Libre — el caso real más común es invalid_grant
// (el refresh_token ya no sirve, ej. porque se revocó el acceso desde
// Mercado Libre) — eso exige RECONECTAR la cuenta, no es un error
// transitorio. No se toca lib/ml/oauth.ts (renovarToken) ni cómo se
// obtiene el token en sí — eso queda aparte (issues #32/#50) — solo se
// envuelve el error de ACÁ, en el único lugar que ya atrapaba la falla
// para liberar el candado (ver más abajo), para que suba algo que una
// página sí pueda distinguir.
export class RenovacionTokenFallidaError extends Error {
  constructor() {
    super("No se pudo renovar la conexión con Mercado Libre — puede que haya que reconectar la cuenta.");
    this.name = "RenovacionTokenFallidaError";
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
    if (!cuenta) throw new CuentaMlNoEncontradaError();
    if (cuenta.desconectadaTs) throw new CuentaDesconectadaError();

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
      // Nunca se traga el error real antes de reemplazarlo por el tipado
      // que sí puede atrapar una pantalla — pero solo se loguea el
      // nombre, nunca error.message completo: oauth.ts mete hasta 300
      // caracteres del cuerpo de la respuesta de Mercado Libre ahí.
      console.warn(`[lib/ml/cuentas] no se pudo renovar el token de la cuenta ${cuentaId}:`, error instanceof Error ? error.name : String(error));
      throw new RenovacionTokenFallidaError();
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

// Tarea "Investigación ML" — a diferencia de pedidos/despachos, esta
// consulta no depende de los datos propios de NINGUNA cuenta puntual
// (busca en el catálogo público de Mercado Libre): cualquier cuenta
// conectada y vigente de la empresa sirve. Se usa la primera conectada
// (la más antigua), para que el resultado no cambie de una búsqueda a
// otra sin ninguna razón real.
export async function obtenerCuentaMlActiva(empresaId: string): Promise<{ id: string } | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [cuenta] = await tx
      .select({ id: cuentasMl.id })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.empresaId, empresaId), isNull(cuentasMl.desconectadaTs)))
      .orderBy(asc(cuentasMl.creadoTs));
    return cuenta ?? null;
  });
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
