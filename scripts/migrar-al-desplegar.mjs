// Aplica solo, en el deploy de STAGING, las migraciones pendientes de
// Drizzle y después db/rls-setup.sql. Pensado para el "Pre-deploy
// command" del servicio web de staging en Railway (ver
// docs/migraciones-al-desplegar.md).
//
// Por qué existe: hasta ahora las migraciones y db/rls-setup.sql se
// aplicaban a mano por túnel, y por eso el equipo usaba turnos de
// migración. En la fase de construcción eso frena a todos; en staging
// se puede automatizar sin tocar producción.
//
// Candados, en este orden (cerrado por defecto):
// 1. Si MIGRAR_AL_DESPLEGAR no es exactamente "1", no hace nada y sale
//    con 0 (así un deploy sin la variable sigue igual que hoy).
// 2. Si la variable está pero RAILWAY_ENVIRONMENT_NAME no está en la
//    lista blanca (solo "staging"), NO migra y sale con 1: es preferible
//    que un deploy falle a que alguien migre producción por error.
// 3. Falta DATABASE_URL -> sale con 1.
// 4. Toma un advisory lock de Postgres para que dos deploys a la vez no
//    migren en paralelo.
// 5. Si falta alguno de los roles que crea db/rls-setup.sql, NO corre
//    el script: crearía el rol con la contraseña de ejemplo
//    (PONE_ACA_...). Los roles se crean una sola vez, a mano.
//
// Las dependencias de base (drizzle-orm, postgres) se importan solo
// después de pasar los candados, para que el caso "no hacer nada" no
// dependa de nada más que Node.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AMBIENTES_PERMITIDOS = ["staging"];

// Número fijo y arbitrario para pg_advisory_lock: identifica "migrar al
// desplegar" en esta base. Cualquier otro proceso que use el mismo
// número esperaría a este, que es justo lo que se quiere.
export const LLAVE_ADVISORY_LOCK = 74_202_411;

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CARPETA_MIGRACIONES = join(RAIZ, "db/migrations");
export const RUTA_RLS_SETUP = join(RAIZ, "db/rls-setup.sql");

/**
 * Decide qué hacer solo a partir de las variables de entorno. Función
 * pura, para poder probarla sin base de datos.
 * @param {Record<string, string | undefined>} env
 * @returns {{ accion: "omitir" | "migrar" | "error", motivo: string }}
 */
export function decidirMigracion(env) {
  if (env.MIGRAR_AL_DESPLEGAR !== "1") {
    return { accion: "omitir", motivo: "MIGRAR_AL_DESPLEGAR no es \"1\": no se migra en este deploy." };
  }
  const ambiente = (env.RAILWAY_ENVIRONMENT_NAME ?? "").trim();
  if (!AMBIENTES_PERMITIDOS.includes(ambiente)) {
    return {
      accion: "error",
      motivo: `MIGRAR_AL_DESPLEGAR=1 pero RAILWAY_ENVIRONMENT_NAME=${JSON.stringify(ambiente)} no está en la lista permitida (${AMBIENTES_PERMITIDOS.join(", ")}). No se migra y el deploy falla a propósito.`,
    };
  }
  if (!env.DATABASE_URL) {
    return { accion: "error", motivo: "Falta DATABASE_URL (superusuario de Postgres) en este servicio." };
  }
  return { accion: "migrar", motivo: `Ambiente ${ambiente}: se aplican migraciones y db/rls-setup.sql.` };
}

/**
 * Saca de db/rls-setup.sql los roles que el script crearía si no
 * existen (los bloques `IF NOT EXISTS (... rolname = 'x')`).
 * @param {string} textoSql
 * @returns {string[]}
 */
export function rolesQueCreaRlsSetup(textoSql) {
  const roles = new Set();
  for (const m of textoSql.matchAll(/rolname\s*=\s*'([a-z_][a-z0-9_]*)'/gi)) roles.add(m[1]);
  return [...roles];
}

function mensajeSeguro(e) {
  // Mismo criterio que db/migrate.ts: nunca el objeto de error completo
  // (puede traer la query o datos de conexión), solo el mensaje.
  return e instanceof Error ? e.message : "Error desconocido.";
}

/**
 * Aplica migraciones + rls-setup contra la base indicada.
 * @param {{ databaseUrl: string, log?: (m: string) => void, esperaMaximaLockMs?: number }} opciones
 */
export async function migrarAlDesplegar({ databaseUrl, log = console.log, esperaMaximaLockMs = 5 * 60_000 }) {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");

  // max: 1 -> una sola conexión, así el advisory lock (de sesión) y las
  // migraciones viven en la misma sesión de Postgres.
  const client = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {},
    connection: { application_name: "migrar-al-desplegar" },
  });
  try {
    const inicio = Date.now();
    for (;;) {
      const [fila] = await client`select pg_try_advisory_lock(${LLAVE_ADVISORY_LOCK}) as tomado`;
      if (fila.tomado) break;
      if (Date.now() - inicio > esperaMaximaLockMs) {
        throw new Error("Otro deploy lleva demasiado tiempo migrando (advisory lock ocupado). Se aborta este deploy.");
      }
      log("Otro deploy está migrando; esperando el advisory lock…");
      await new Promise((r) => setTimeout(r, 3000));
    }

    log("Aplicando migraciones pendientes de db/migrations/…");
    await migrate(drizzle(client), { migrationsFolder: CARPETA_MIGRACIONES });
    log("Migraciones al día.");

    const textoRls = readFileSync(RUTA_RLS_SETUP, "utf8");
    const roles = rolesQueCreaRlsSetup(textoRls);
    const existentes = await client`select rolname from pg_roles where rolname in ${client(roles)}`;
    const faltan = roles.filter((r) => !existentes.some((f) => f.rolname === r));
    if (faltan.length > 0) {
      throw new Error(
        `Faltan roles de base (${faltan.join(", ")}). db/rls-setup.sql los crearía con la contraseña de ejemplo, así que no se corre. Créalos a mano una vez (docs/rls.md) y vuelve a desplegar.`
      );
    }

    log("Aplicando db/rls-setup.sql (en una sola transacción)…");
    await client.begin(async (tx) => {
      await tx.unsafe(textoRls);
    });
    log("db/rls-setup.sql aplicado.");

    await client`select pg_advisory_unlock(${LLAVE_ADVISORY_LOCK})`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main() {
  const decision = decidirMigracion(process.env);
  if (decision.accion === "omitir") {
    console.log(`[migrar-al-desplegar] ${decision.motivo}`);
    return;
  }
  if (decision.accion === "error") {
    console.error(`[migrar-al-desplegar] ${decision.motivo}`);
    process.exit(1);
  }
  console.log(`[migrar-al-desplegar] ${decision.motivo}`);
  await migrarAlDesplegar({
    databaseUrl: /** @type {string} */ (process.env.DATABASE_URL),
    log: (m) => console.log(`[migrar-al-desplegar] ${m}`),
  });
  console.log("[migrar-al-desplegar] Listo.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[migrar-al-desplegar] Falló: ${mensajeSeguro(e)}`);
    process.exit(1);
  });
}
