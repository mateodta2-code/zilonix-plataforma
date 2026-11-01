import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { MARCA_BACKFILL_PERMISOS_PROMOCIONES, SQL_BACKFILL_PERMISOS_PROMOCIONES } from "./backfill-permisos-promociones";

describe("backfill de permisos de promociones (Refs #44)", () => {
  it("la migración 0018 trae el mismo SQL que ejecuta la prueba de roles", () => {
    const archivo = readFileSync("db/migrations/0018_backfill_permisos_promociones.sql", "utf8");
    expect(archivo).toContain(MARCA_BACKFILL_PERMISOS_PROMOCIONES);
    for (const sentencia of SQL_BACKFILL_PERMISOS_PROMOCIONES) {
      expect(archivo).toContain(sentencia);
    }
  });
});
