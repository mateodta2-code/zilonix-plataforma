import { pathToFileURL } from "url";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { cifrarToken, descifrarToken, versionClaveActual, type TokenCifrado } from "../lib/cifrado";
import * as schema from "../db/schema";
import { cuentasMl } from "../db/schema";

// Z-SEC-01 — re-cifra los tokens de `cuentas_ml` a la versión de
// `ML_TOKEN_KEY_ACTUAL`. Idempotente: una fila que ya está en esa
// versión no se vuelve a escribir.
//
// Rol: el superusuario de DATABASE_URL (el mismo de npm run db:migrate),
// no superadmin_user. superadmin_user no tiene GRANT sobre cuentas_ml
// y, por la decisión D8, no ve datos de negocio; un token lo es.
// app_user solo ve la empresa de la transacción. trabajador_user solo
// toca avisos_ml. Sin una migración (el turno 0008–0010 está ocupado)
// el superusuario es el único rol que cruza empresas. El porqué y el
// orden de la rotación están en docs/rotacion-claves.md.
//
// Esta conexión no la importa la app. Se abre acá y se cierra al
// terminar, igual que db/migrate.ts.

type Db = PostgresJsDatabase<typeof schema>;

export class RecifradoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "RecifradoError";
  }
}

export type ConteoRecifrado = {
  revisadas: number;
  conVersionAnterior: number;
  actualizadas: number;
  yaActuales: number;
  dryRun: boolean;
};

export type VersionesFila = {
  id: string;
  versionAccess: number;
  versionRefresh: number;
};

// El listado solo trae el número de versión, nunca el texto cifrado:
// --dry-run no necesita (y no debe) tener el token en memoria.
// La escritura bloquea la fila y recién ahí lee el cifrado, para no
// pisar un refresh que haya commiteado entre el listado y el UPDATE
// (lib/ml/cuentas.ts sostiene el candado durante la llamada a Mercado
// Libre; FOR UPDATE espera ese candado en vez de saltar la fila).
export interface RepositorioRecifrado {
  listarVersiones(ids?: readonly string[]): Promise<VersionesFila[]>;
  recifrarSiAtrasada(id: string, versionActual: number): Promise<"actualizada" | "ya_actual">;
}

export function textoConteo(conteo: ConteoRecifrado): string {
  const simulacion = conteo.dryRun ? "sí" : "no";
  return `Revisadas: ${conteo.revisadas}. Encontradas atrás: ${conteo.conVersionAnterior}. Actualizadas: ${conteo.actualizadas}. Ya en la versión actual: ${conteo.yaActuales}. Simulación: ${simulacion}.`;
}

// Cualquier otro error (el de Postgres, sobre todo) puede arrastrar la
// consulta y sus parámetros. Esos parámetros son el token cifrado.
// Solo se deja pasar un texto que armamos nosotros y que no tiene
// ni el token ni la clave.
export function mensajeErrorSeguro(error: unknown): string {
  if (error instanceof RecifradoError) return error.message;
  if (error instanceof Error && error.message === "Falta DATABASE_URL.") return error.message;
  if (error instanceof Error && error.message.startsWith("ML_TOKEN_KEY_ACTUAL debe")) return error.message;
  return "No se pudo recifrar. No se imprimen tokens, claves ni el error interno.";
}

export function leerOpciones(argv: readonly string[]): { dryRun: boolean } {
  if (argv.some((arg) => arg !== "--dry-run")) {
    throw new RecifradoError("Uso: npm run tokens:recifrar -- [--dry-run]");
  }
  return { dryRun: argv.includes("--dry-run") };
}

function parsearVersion(valor: unknown): number {
  if (typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= 999) return valor;
  if (typeof valor === "string" && /^[1-9]\d{0,2}$/.test(valor)) return Number(valor);
  throw new RecifradoError("No se puede recifrar: una fila tiene una versión de clave inválida. No se escribió nada.");
}

function errorRecifradoSeguro(error: unknown): RecifradoError {
  if (error instanceof RecifradoError) return error;
  const mensaje = error instanceof Error ? error.message : "";
  const falta = mensaje.match(/^Falta la variable de entorno (ML_TOKEN_KEY_V\d+) para descifrar\/cifrar tokens\.$/);
  if (falta) {
    return new RecifradoError(`No se puede recifrar: falta ${falta[1]}. La fila no se modificó.`);
  }
  const corta = mensaje.match(/^(ML_TOKEN_KEY_V\d+) debe ser una clave de 32 bytes en base64\.$/);
  if (corta) {
    return new RecifradoError(`No se puede recifrar: ${corta[1]} no es una clave de 32 bytes. La fila no se modificó.`);
  }
  return new RecifradoError("No se puede recifrar: un token no se pudo descifrar. La fila no se modificó.");
}

function recifrarUno(token: TokenCifrado, versionActual: number): TokenCifrado {
  const version = parsearVersion(token.version);
  // Una versión más nueva que la actual no se baja: sería volver a
  // cifrar con una clave que ya se está dejando atrás.
  if (version >= versionActual) return token;
  let plano: string;
  try {
    plano = descifrarToken({ ...token, version });
  } catch (error) {
    throw errorRecifradoSeguro(error);
  }
  const nuevo = cifrarToken(plano);
  if (nuevo.version !== versionActual) {
    throw new RecifradoError("No se puede recifrar: la clave actual no coincide con la versión esperada. La fila no se modificó.");
  }
  return nuevo;
}

export function prepararRecifrado(
  fila: { access: TokenCifrado; refresh: TokenCifrado },
  versionActual: number
): { access: TokenCifrado; refresh: TokenCifrado; cambia: boolean } {
  const access = recifrarUno(fila.access, versionActual);
  const refresh = recifrarUno(fila.refresh, versionActual);
  return { access, refresh, cambia: access !== fila.access || refresh !== fila.refresh };
}

export async function recifrarCuentasMl(
  repo: RepositorioRecifrado,
  opciones: { dryRun: boolean; ids?: readonly string[] }
): Promise<ConteoRecifrado> {
  const versionActual = versionClaveActual();
  const filas = await repo.listarVersiones(opciones.ids);
  const pendientes: string[] = [];
  let yaActuales = 0;
  for (const fila of filas) {
    if (fila.versionAccess < versionActual || fila.versionRefresh < versionActual) pendientes.push(fila.id);
    else yaActuales += 1;
  }
  if (opciones.dryRun) {
    return {
      revisadas: filas.length,
      conVersionAnterior: pendientes.length,
      actualizadas: 0,
      yaActuales,
      dryRun: true,
    };
  }
  let actualizadas = 0;
  for (const id of pendientes) {
    const resultado = await repo.recifrarSiAtrasada(id, versionActual);
    if (resultado === "actualizada") actualizadas += 1;
    else yaActuales += 1;
  }
  return {
    revisadas: filas.length,
    conVersionAnterior: pendientes.length,
    actualizadas,
    yaActuales,
    dryRun: false,
  };
}

function primeraFila(resultado: unknown): { rol?: unknown; puede?: unknown } | undefined {
  if (Array.isArray(resultado)) return resultado[0] as { rol?: unknown; puede?: unknown } | undefined;
  if (resultado && typeof resultado === "object" && "rows" in resultado) {
    const rows = (resultado as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows[0] as { rol?: unknown; puede?: unknown } | undefined;
  }
  return undefined;
}

export async function afirmarRolCruzaEmpresas(db: Db): Promise<void> {
  let resultado: unknown;
  try {
    resultado = await db.execute(
      sql`SELECT current_user AS rol, (rolsuper OR rolbypassrls) AS puede FROM pg_roles WHERE rolname = current_user`
    );
  } catch {
    throw new RecifradoError("No se pudo comprobar el rol de la conexión. No se reescribió nada.");
  }
  const fila = primeraFila(resultado);
  if (fila?.puede !== true) {
    const rol = typeof fila?.rol === "string" && fila.rol.length > 0 ? fila.rol : "desconocido";
    throw new RecifradoError(
      `No se reescribió nada: el rol ${rol} no cruza empresas. Hay que usar el superusuario de DATABASE_URL, el mismo de las migraciones.`
    );
  }
}

export function crearRepositorioPostgres(db: Db): RepositorioRecifrado {
  return {
    async listarVersiones(ids) {
      if (ids && ids.length === 0) return [];
      const consulta = db
        .select({
          id: cuentasMl.id,
          versionAccess: sql<string | null>`access_token_cifrado->>'version'`.as("version_access"),
          versionRefresh: sql<string | null>`refresh_token_cifrado->>'version'`.as("version_refresh"),
        })
        .from(cuentasMl);
      const filas = ids ? await consulta.where(inArray(cuentasMl.id, [...ids])) : await consulta;
      return filas.map((fila) => ({
        id: fila.id,
        versionAccess: parsearVersion(fila.versionAccess),
        versionRefresh: parsearVersion(fila.versionRefresh),
      }));
    },
    async recifrarSiAtrasada(id, versionActual) {
      return db.transaction(async (tx) => {
        const [fila] = await tx
          .select({
            access: cuentasMl.accessTokenCifrado,
            refresh: cuentasMl.refreshTokenCifrado,
          })
          .from(cuentasMl)
          .where(eq(cuentasMl.id, id))
          .for("update");
        if (!fila) return "ya_actual" as const;
        let preparado: ReturnType<typeof prepararRecifrado>;
        try {
          preparado = prepararRecifrado({ access: fila.access, refresh: fila.refresh }, versionActual);
        } catch (error) {
          // Si esto se propaga como un error de Postgres, el driver
          // puede meter el cifrado en el mensaje. Se convierte antes
          // de salir de la transacción; el throw igual la deshace.
          throw error instanceof RecifradoError ? error : errorRecifradoSeguro(error);
        }
        if (!preparado.cambia) return "ya_actual" as const;
        await tx
          .update(cuentasMl)
          .set({
            ...(preparado.access !== fila.access ? { accessTokenCifrado: preparado.access } : {}),
            ...(preparado.refresh !== fila.refresh ? { refreshTokenCifrado: preparado.refresh } : {}),
          })
          .where(eq(cuentasMl.id, id));
        return "actualizada" as const;
      });
    },
  };
}

export function abrirConexion(url: string | undefined, falta: string): { db: Db; cerrar: () => Promise<void> } {
  if (!url) throw new Error(falta);
  const client = postgres(url, { max: 1 });
  return {
    db: drizzle(client, { schema }),
    cerrar: () => client.end(),
  };
}

export async function ejecutarRecifrado(opciones: {
  dryRun: boolean;
  ids?: readonly string[];
  conexion?: { db: Db; cerrar: () => Promise<void> };
}): Promise<ConteoRecifrado> {
  const propia = !opciones.conexion;
  const conexion = opciones.conexion ?? abrirConexion(process.env.DATABASE_URL, "Falta DATABASE_URL.");
  try {
    await afirmarRolCruzaEmpresas(conexion.db);
    const repo = crearRepositorioPostgres(conexion.db);
    return await recifrarCuentasMl(repo, { dryRun: opciones.dryRun, ids: opciones.ids });
  } finally {
    if (propia) await conexion.cerrar();
  }
}

export function esEntradaDirecta(): boolean {
  return process.argv.slice(1).some((entrada) => {
    try {
      return import.meta.url === pathToFileURL(entrada).href;
    } catch {
      return false;
    }
  });
}

async function main() {
  try {
    const opciones = leerOpciones(process.argv.slice(2));
    const conteo = await ejecutarRecifrado({ dryRun: opciones.dryRun });
    console.log(textoConteo(conteo));
  } catch (error) {
    console.error(mensajeErrorSeguro(error));
    process.exit(1);
  }
}

if (esEntradaDirecta()) {
  void main();
}
