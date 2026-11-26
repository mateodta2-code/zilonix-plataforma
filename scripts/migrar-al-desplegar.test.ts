import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  AMBIENTES_PERMITIDOS,
  decidirMigracion,
  rolesQueCreaRlsSetup,
} from "./migrar-al-desplegar.mjs";

// Candados de scripts/migrar-al-desplegar.mjs (migraciones automáticas
// en el deploy de staging). Lo que se prueba acá es la decisión de
// migrar o no, que es lo que protege a producción; la aplicación real
// contra Postgres la cubre el paso de CI que corre el script dos veces
// seguidas contra el Postgres efímero.
describe("decidirMigracion — cerrado por defecto", () => {
  const url = "postgresql://ejemplo@localhost:5432/railway";

  it("sin MIGRAR_AL_DESPLEGAR -> omitir (producción sigue igual que hoy)", () => {
    expect(decidirMigracion({ RAILWAY_ENVIRONMENT_NAME: "production", DATABASE_URL: url }).accion).toBe("omitir");
    expect(decidirMigracion({}).accion).toBe("omitir");
  });

  it("MIGRAR_AL_DESPLEGAR con otro valor que no sea \"1\" -> omitir", () => {
    for (const valor of ["0", "true", "si", " 1", ""]) {
      expect(decidirMigracion({ MIGRAR_AL_DESPLEGAR: valor, RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: url }).accion).toBe("omitir");
    }
  });

  it("MIGRAR_AL_DESPLEGAR=1 en production -> error (no migra y el deploy falla)", () => {
    expect(decidirMigracion({ MIGRAR_AL_DESPLEGAR: "1", RAILWAY_ENVIRONMENT_NAME: "production", DATABASE_URL: url }).accion).toBe("error");
  });

  it("MIGRAR_AL_DESPLEGAR=1 sin RAILWAY_ENVIRONMENT_NAME o con un nombre desconocido -> error", () => {
    for (const ambiente of [undefined, "", "Production", "prod", "staging-2", "pr-415"]) {
      expect(decidirMigracion({ MIGRAR_AL_DESPLEGAR: "1", RAILWAY_ENVIRONMENT_NAME: ambiente, DATABASE_URL: url }).accion).toBe("error");
    }
  });

  it("MIGRAR_AL_DESPLEGAR=1 en staging sin DATABASE_URL -> error", () => {
    expect(decidirMigracion({ MIGRAR_AL_DESPLEGAR: "1", RAILWAY_ENVIRONMENT_NAME: "staging" }).accion).toBe("error");
  });

  it("MIGRAR_AL_DESPLEGAR=1 en staging con DATABASE_URL -> migrar", () => {
    expect(decidirMigracion({ MIGRAR_AL_DESPLEGAR: "1", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: url }).accion).toBe("migrar");
  });

  it("la lista blanca de ambientes nunca incluye producción", () => {
    expect(AMBIENTES_PERMITIDOS).toEqual(["staging"]);
  });
});

describe("rolesQueCreaRlsSetup", () => {
  it("encuentra los 6 roles que hoy crea db/rls-setup.sql", () => {
    const texto = readFileSync(join(process.cwd(), "db/rls-setup.sql"), "utf8");
    expect(rolesQueCreaRlsSetup(texto).sort()).toEqual(
      ["app_user", "falabella_trabajador_user", "publicidad_trabajador_user", "seguimiento_trabajador_user", "superadmin_user", "trabajador_user"].sort()
    );
  });

  it("todo rol creado con contraseña de ejemplo está cubierto por la verificación previa", () => {
    // Si alguien agrega un CREATE ROLE nuevo a rls-setup.sql, tiene que
    // ir dentro de un IF NOT EXISTS (... rolname = '...') para que el
    // script automático lo detecte y no lo cree con PONE_ACA_....
    const texto = readFileSync(join(process.cwd(), "db/rls-setup.sql"), "utf8");
    const creados = [...texto.matchAll(/CREATE ROLE\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
    const verificados = rolesQueCreaRlsSetup(texto);
    expect(creados.filter((r) => !verificados.includes(r))).toEqual([]);
  });
});
