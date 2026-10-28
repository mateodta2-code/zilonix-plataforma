import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { MARCA_BACKFILL_PERMISOS_PUBLICIDAD, SQL_BACKFILL_PERMISOS_PUBLICIDAD } from "./backfill-permisos";

describe("backfill de publicidad.consultar (issue #254)", () => {
  it("la migración 0011 trae el mismo SQL que ejecuta la prueba de roles", () => {
    const archivo = readFileSync("db/migrations/0011_publicidad_product_ads.sql", "utf8");
    expect(archivo).toContain(MARCA_BACKFILL_PERMISOS_PUBLICIDAD);
    for (const sentencia of SQL_BACKFILL_PERMISOS_PUBLICIDAD) {
      expect(archivo).toContain(sentencia);
    }
  });
});
