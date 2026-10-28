import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { dbComoEmpresa, dbComoTransferenciaCuentaMl } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import { renovarToken, type TokensMl } from "@/lib/ml/oauth";

const SEGUNDOS_DE_MARGEN = 120; // renovar un poco antes de que venza, no justo al filo
const CANDADO_ABANDONADO_MS = 30_000; // tarea 2.3: un candado de más de 30s se considera caído, se puede retomar

function expiraTsDesdeAhora(tokens: TokensMl): Date {
  return new Date(Date.now() + (tokens.expiraEnSegundos - SEGUNDOS_DE_MARGEN) * 1000);
}

// Bug real en vivo en staging: reconectar una cuenta de Mercado Libre
// que YA tenía una fila (conectada o desconectada) reventaba con
// "duplicate key value violates unique constraint
// cuentas_ml_cuenta_externa_unica" — guardarCuentaConectada hacía un
// INSERT simple y desconectarCuenta solo marca desconectadaTs (nunca
// borra la fila, a propósito, para no perder el histórico importado),
// así que la misma cuenta de ML nunca se podía volver a conectar.
//
// INSERT ... ON CONFLICT (cuenta_id_externa) DO UPDATE ... WHERE
// empresa_id = la empresa actual: si la fila que choca es de la MISMA
// empresa (conectada o desconectada), se reactiva esa misma fila
// (mismo id — se conserva el histórico) con los tokens nuevos. Si la
// fila que choca es de OTRA empresa, el WHERE no matchea: ni el
// INSERT ni el UPDATE se aplican, así que no hay ninguna fila que
// RETURNING pueda devolver.
export class CuentaMlDeOtraEmpresaError extends Error {
  constructor() {
    // Nunca revela A QUÉ empresa pertenece — pedido explícito.
    super("Esta cuenta de Mercado Libre ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.");
    this.name = "CuentaMlDeOtraEmpresaError";
  }
}

function esViolacionDeUnicidad(error: unknown): boolean {
  // 23505 = unique_violation de Postgres — mismo chequeo que ya usan
  // lib/invitaciones.ts, lib/ml/sku.ts y app/crear-empresa/actions.ts.
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export async function guardarCuentaConectada(
  empresaId: string,
  datos: { cuentaIdExterna: string; nickname: string; tokens: TokensMl }
): Promise<{ id: string }> {
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
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
        .onConflictDoUpdate({
          target: cuentasMl.cuentaIdExterna,
          set: {
            nickname: datos.nickname,
            accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
            refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
            tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
            desconectadaTs: null,
            renovandoTs: null,
          },
          // Referencia a la fila YA existente (la que choca), no a los
          // valores nuevos — por eso compara contra `empresaId`
          // (variable de JS), nunca contra `excluded`.
          setWhere: eq(cuentasMl.empresaId, empresaId),
        })
        .returning({ id: cuentasMl.id });

      if (!fila) throw new CuentaMlDeOtraEmpresaError();
      return fila;
    });
  } catch (error) {
    if (error instanceof CuentaMlDeOtraEmpresaError) throw error;
    // Caso real esperado con RLS a FORCE (ver db/rls-setup.sql): si la
    // fila que choca es de otra empresa, ni siquiera es visible para
    // decidir el UPDATE — Postgres corta con el 23505 de siempre en
    // vez de dejar que el RETURNING vuelva vacío. Mismo resultado para
    // quien llama: nunca el error crudo de Postgres en pantalla.
    if (esViolacionDeUnicidad(error)) throw new CuentaMlDeOtraEmpresaError();
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

// Issue #181 — en vez de solo avisar "ya está conectada a otra
// empresa" (CuentaMlDeOtraEmpresaError, arriba), la pantalla de
// confirmación necesita saber a CUÁL — dato que esa clase de error a
// propósito nunca revela. Solo lectura, nunca modifica nada: corre
// bajo dbComoTransferenciaCuentaMl (db/empresa-context.ts), el camino
// acotado que ve ESA fila puntual sin importar la empresa, nunca el
// superusuario ni app.empresa_actual.
export async function obtenerEmpresaDueñaDeCuentaMl(cuentaIdExterna: string): Promise<{ empresaId: string; empresaNombre: string } | null> {
  return dbComoTransferenciaCuentaMl(cuentaIdExterna, async (tx) => {
    const [fila] = await tx
      .select({ empresaId: cuentasMl.empresaId, empresaNombre: empresas.nombre })
      .from(cuentasMl)
      .innerJoin(empresas, eq(empresas.id, cuentasMl.empresaId))
      .where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna));
    return fila ?? null;
  });
}

// Issue #181 — confirmada la transferencia, mueve la ÚNICA fila de
// cuentas_ml (índice único sobre cuenta_id_externa) de la empresa
// anterior a la actual: nuevo empresa_id, tokens y nickname nuevos
// (los que se acaban de autorizar), se reactiva si estaba desconectada
// allá. A propósito NUNCA toca pedidos/publicaciones/importaciones_ml
// de la empresa anterior — solo la conexión cambia de dueño, el
// histórico se queda donde está (mismo principio que desconectarCuenta,
// arriba, nunca borra nada).
export async function transferirCuentaMlAOtraEmpresa(
  empresaDestinoId: string,
  datos: { cuentaIdExterna: string; nickname: string; tokens: TokensMl }
): Promise<{ id: string }> {
  return dbComoTransferenciaCuentaMl(datos.cuentaIdExterna, async (tx) => {
    const [fila] = await tx
      .update(cuentasMl)
      .set({
        empresaId: empresaDestinoId,
        nickname: datos.nickname,
        accessTokenCifrado: cifrarToken(datos.tokens.accessToken),
        refreshTokenCifrado: cifrarToken(datos.tokens.refreshToken),
        tokenExpiraTs: expiraTsDesdeAhora(datos.tokens),
        desconectadaTs: null,
        renovandoTs: null,
        // Issue #125 — el titular es de la empresa anterior. La FK
        // compuesta (empresa_id, titular_id) rechaza el cambio de
        // empresa con el titular viejo puesto.
        titularId: null,
      })
      .where(eq(cuentasMl.cuentaIdExterna, datos.cuentaIdExterna))
      .returning({ id: cuentasMl.id });

    // Caso raro (carrera): entre que se armó la pantalla de
    // confirmación y que se envió, la fila desapareció (la empresa
    // dueña se borró, con el cascade de empresas.id). Nunca se asume
    // éxito sin fila devuelta.
    if (!fila) throw new CuentaMlNoEncontradaError();
    return fila;
  });
}
