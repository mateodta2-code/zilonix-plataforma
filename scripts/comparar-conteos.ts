// Z-MT-11. Compara cuántas filas tiene cada tabla de `public` entre la
// base de origen y una base restaurada en otro servicio. Solo lee.
//
// No imprime cadenas de conexión, filas, ni el error crudo del driver:
// postgres.js a veces mete datos de conexión en el mensaje. La salida
// son nombres de tabla y dos conteos.
//
//   DATABASE_URL_ORIGEN=... DATABASE_URL_RESTAURADA=... npx tsx scripts/comparar-conteos.ts
//
// Código 0 si cada tabla tiene el mismo conteo en los dos lados.
// Código 1 si falta una variable, si las dos URLs son la misma base,
// si el rol no salta RLS, si no se puede leer, o si algún conteo difiere.

import postgres from "postgres";
import {
  VARIABLE_ORIGEN,
  VARIABLE_RESTAURADA,
  citarTabla,
  compararConteos,
  consultaConteos,
  conteoDesdeTexto,
  decisionSaltoRls,
  esLaMismaBase,
  formatearComparacion,
  hayDiferencias,
  mensajeErrorSeguro,
  mensajeVariablesFaltantes,
  urlsSonIguales,
  variablesFaltantes,
  type ConteoTabla,
  type IdentidadBase,
  type LadoConexion,
} from "./comparar-conteos-logica";

type FilaIdentidad = { base: string; dir: string; puerto: string };
type FilaConteo = { tabla: string; filas: string };
type FilaTabla = { tabla: string };

async function main() {
  const faltan = variablesFaltantes(process.env);
  if (faltan.length > 0) {
    console.error(mensajeVariablesFaltantes(faltan));
    process.exitCode = 1;
    return;
  }

  const urlOrigen = process.env[VARIABLE_ORIGEN] ?? "";
  const urlRestaurada = process.env[VARIABLE_RESTAURADA] ?? "";
  if (urlsSonIguales(urlOrigen, urlRestaurada)) {
    console.error(
      "DATABASE_URL_ORIGEN y DATABASE_URL_RESTAURADA son la misma cadena. " +
        "La restaurada tiene que ser la base temporal. No se imprime la cadena.",
    );
    process.exitCode = 1;
    return;
  }

  let origen: { identidad: IdentidadBase; conteos: ConteoTabla[] };
  let restaurada: { identidad: IdentidadBase; conteos: ConteoTabla[] };
  try {
    origen = await leerLado("origen", urlOrigen);
  } catch (error) {
    informarFalloDeLectura("origen", error);
    process.exitCode = 1;
    return;
  }
  try {
    restaurada = await leerLado("restaurada", urlRestaurada);
  } catch (error) {
    informarFalloDeLectura("restaurada", error);
    process.exitCode = 1;
    return;
  }

  if (esLaMismaBase(origen.identidad, restaurada.identidad)) {
    console.error(
      "Las dos conexiones son la misma base (mismo nombre y misma dirección de servidor). " +
        "La restaurada tiene que ser otra base, temporal. No se imprime la cadena de conexión.",
    );
    process.exitCode = 1;
    return;
  }

  const filas = compararConteos(origen.conteos, restaurada.conteos);
  const texto = formatearComparacion(filas);
  if (texto !== "") console.log(texto);
  if (filas.length === 0) {
    console.error("No hay tablas en el esquema public de ninguno de los dos lados.");
  }
  process.exitCode = hayDiferencias(filas) ? 1 : 0;
}

function informarFalloDeLectura(lado: LadoConexion, error: unknown) {
  if (error instanceof Error && error.name === "ConexionNoSaltaRls") {
    console.error(error.message);
    return;
  }
  const donde = lado === "origen" ? "el origen" : "la base restaurada";
  console.error(`No se pudo leer ${donde}. ${mensajeErrorSeguro(error)}`);
}

// `begin read only` hace que Postgres rechace cualquier escritura de
// esta conexión. Antes de contar se mira si el rol salta RLS: con
// FORCE ROW LEVEL SECURITY, el dueño de la tabla también queda filtrado,
// y un conteo de app_user no se puede comparar con el del superusuario.
// El conteo va calificado con public."tabla" y el nombre sale de
// pg_tables, citado solo si es un identificador simple.
async function leerLado(
  lado: LadoConexion,
  url: string,
): Promise<{ identidad: IdentidadBase; conteos: ConteoTabla[] }> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 20,
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    return await sql.begin("read only", async (tx) => {
      const [privilegio] = await tx<{ salta_rls: boolean | null }[]>`
        SELECT rolsuper OR rolbypassrls AS salta_rls
        FROM pg_roles
        WHERE rolname = current_user
      `;
      const decision = decisionSaltoRls(lado, privilegio?.salta_rls ?? null);
      if (!decision.ok) {
        const error = new Error(decision.mensaje);
        error.name = "ConexionNoSaltaRls";
        throw error;
      }

      const [id] = await tx<FilaIdentidad[]>`
        SELECT current_database()::text AS base,
               coalesce(inet_server_addr()::text, '') AS dir,
               coalesce(inet_server_port()::text, '') AS puerto
      `;
      if (!id) throw new Error("Postgres no devolvió la identidad de la base.");

      const tablas = await tx<FilaTabla[]>`
        SELECT tablename AS tabla
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      const nombres = tablas.map((fila) => fila.tabla);
      for (const nombre of nombres) citarTabla(nombre);

      const crudos =
        nombres.length === 0
          ? []
          : await tx.unsafe<FilaConteo[]>(consultaConteos(nombres));
      const conteos = crudos.map((fila) => conteoDesdeTexto(fila.tabla, fila.filas));
      return {
        identidad: { base: id.base, dir: id.dir, puerto: String(id.puerto) },
        conteos,
      };
    });
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Cerrar no debe tapar el error de la lectura ni imprimir la URL.
    }
  }
}

const ejecutadoDirecto = process.argv[1]?.endsWith("comparar-conteos.ts") ?? false;
if (ejecutadoDirecto) {
  main().catch((error) => {
    console.error(mensajeErrorSeguro(error));
    process.exitCode = 1;
  });
}
