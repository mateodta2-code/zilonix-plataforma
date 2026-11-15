import { describe, expect, it } from "vitest";
import { motivoDeNegacion, rolesFaltantes, ROLES_RLS } from "./migrar-staging-logica";

const ok = { MIGRAR_AL_DESPLEGAR: "staging", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: "x" };

describe("migrador automático de staging — barreras", () => {
  it("staging con la variable correcta -> permitido", () => {
    expect(motivoDeNegacion(ok)).toBeNull();
  });
  it("sin MIGRAR_AL_DESPLEGAR o con otro valor -> negado", () => {
    expect(motivoDeNegacion({ ...ok, MIGRAR_AL_DESPLEGAR: undefined })).not.toBeNull();
    expect(motivoDeNegacion({ ...ok, MIGRAR_AL_DESPLEGAR: "production" })).not.toBeNull();
  });
  it("entorno production/produccion (cualquier mayúscula) -> negado aunque la variable valga staging", () => {
    for (const nombre of ["production", "Production", "produccion", "PRODUCCIÓN"]) {
      expect(motivoDeNegacion({ ...ok, RAILWAY_ENVIRONMENT_NAME: nombre })).toMatch(/producción/);
    }
  });
  it("sin DATABASE_URL -> negado", () => {
    expect(motivoDeNegacion({ ...ok, DATABASE_URL: undefined })).toMatch(/DATABASE_URL/);
  });
  it("el mensaje nunca incluye la URL", () => {
    const m = motivoDeNegacion({ ...ok, DATABASE_URL: "postgres://u:secreto@h/db", MIGRAR_AL_DESPLEGAR: "no" });
    expect(m).not.toContain("secreto");
  });
  it("detecta roles que faltan", () => {
    expect(rolesFaltantes([...ROLES_RLS])).toEqual([]);
    expect(rolesFaltantes(["app_user"])).toHaveLength(ROLES_RLS.length - 1);
  });
});
