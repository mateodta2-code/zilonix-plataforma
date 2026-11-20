import { beforeEach, describe, expect, it, vi } from "vitest";

// resolverAtributosObligatorios con la definición real de la categoría
// (MCO191758) mockeada — sin base de datos ni red.
const atributosMock = vi.hoisted(() => ({ lista: [] as unknown[] }));
vi.mock("@/lib/ml/cliente", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ml/cliente")>()),
  leerAtributosCategoriaMl: vi.fn(async () => atributosMock.lista),
}));

vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));
vi.mock("@/db/schema", async () => ({}));

import { resolverAtributosObligatorios } from "./publicar";
import { UnidadInvalidaError } from "./publicar-reglas";

const CON_UNIDADES = [
  { id: "MAX_RECOMMENDED_AGE", name: "Edad máxima recomendada", value_type: "number_unit", default_unit: "años", allowed_units: [{ id: "años", name: "años" }, { id: "meses", name: "meses" }] },
  { id: "WEIGHT", name: "Peso", value_type: "number_unit", default_unit: "g", allowed_units: [{ id: "g", name: "g" }, { id: "kg", name: "kg" }, { id: "mg", name: "mg" }] },
  { id: "WIDTH", name: "Ancho", value_type: "number_unit", default_unit: "cm", allowed_units: [{ id: "cm", name: "cm" }, { id: "mm", name: "mm" }] },
];

async function resolver(extra: Record<string, string>) {
  const r = await resolverAtributosObligatorios("MCO191758", extra, "Paracaídas Juguete");
  return Object.fromEntries(r.atributos.map((a) => [a.id, a.value_name]));
}

describe("resolverAtributosObligatorios — atributos number_unit", () => {
  beforeEach(() => {
    atributosMock.lista = CON_UNIDADES;
  });
  it("«18» → «18 años» y «500» → «500 g»", async () => {
    const r = await resolver({ MAX_RECOMMENDED_AGE: "18", WEIGHT: "500" });
    expect(r.MAX_RECOMMENDED_AGE).toBe("18 años");
    expect(r.WEIGHT).toBe("500 g");
  });
  it("«18 meses» se respeta", async () => {
    expect((await resolver({ MAX_RECOMMENDED_AGE: "18 meses" })).MAX_RECOMMENDED_AGE).toBe("18 meses");
  });
  it("«18 kg» en edad lanza error con las unidades permitidas, antes de llamar a ML", async () => {
    await expect(resolver({ MAX_RECOMMENDED_AGE: "18 kg" })).rejects.toThrow(UnidadInvalidaError);
    await expect(resolver({ MAX_RECOMMENDED_AGE: "18 kg" })).rejects.toThrow(/años, meses/);
  });
  it("«N/A» se omite", async () => {
    expect((await resolver({ MAX_RECOMMENDED_AGE: "N/A" })).MAX_RECOMMENDED_AGE).toBeUndefined();
  });
  it("sin allowed_units en la categoría usa el respaldo", async () => {
    atributosMock.lista = [{ id: "MAX_RECOMMENDED_AGE", name: "Edad máxima recomendada", value_type: "number_unit" }];
    expect((await resolver({ MAX_RECOMMENDED_AGE: "18" })).MAX_RECOMMENDED_AGE).toBe("18 años");
  });
});
