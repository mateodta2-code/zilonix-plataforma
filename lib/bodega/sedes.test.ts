import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const BODEGA = "22222222-2222-4222-8222-222222222222";
const SEDE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "11111111-1111-4111-8111-111111111111";

const estado: { inserts: { tabla: string; valores: Record<string, unknown> }[]; updates: Record<string, unknown>[]; antes: Record<string, unknown> | undefined; llamadas: number } = {
  inserts: [],
  updates: [],
  antes: undefined,
  llamadas: 0,
};

vi.mock("@/db/bodega-context", () => ({
  dbComoBodega: async (_b: string, fn: (tx: unknown) => Promise<unknown>) => {
    estado.llamadas += 1;
    const tx = {
      insert: (tabla: object) => ({ values: async (valores: Record<string, unknown>) => void estado.inserts.push({ tabla: getTableName(tabla as never), valores }) }),
      select: () => ({ from: () => ({ where: async () => (estado.antes ? [estado.antes] : []) }) }),
      update: () => ({ set: (valores: Record<string, unknown>) => ({ where: async () => void estado.updates.push(valores) }) }),
    };
    return fn(tx);
  },
}));

import { SedeBodegaError, cambiarActivaSede, crearSede, editarSede } from "./sedes";

beforeEach(() => {
  estado.inserts = [];
  estado.updates = [];
  estado.llamadas = 0;
  estado.antes = { id: SEDE, bodegaId: BODEGA, nombre: "Vieja", direccion: null, ciudad: null, activa: true };
});

describe("sedes de la bodega", () => {
  it("el admin crea una sede y queda su auditoría", async () => {
    await crearSede(BODEGA, ACTOR, "admin_bodega", { nombre: "Sede Sur", ciudad: "Cali" });
    expect(estado.inserts.map((i) => i.tabla)).toEqual(["sedes_bodega", "auditoria"]);
    expect(estado.inserts[1].valores).toMatchObject({ accion: "sede_creada", entidad: "sede_bodega" });
  });

  it("el admin edita y desactiva con auditoría", async () => {
    await editarSede(BODEGA, ACTOR, "admin_bodega", SEDE, { nombre: "Nueva", direccion: "Calle 1" });
    await cambiarActivaSede(BODEGA, ACTOR, "admin_bodega", SEDE, false);
    expect(estado.updates).toEqual([{ nombre: "Nueva", direccion: "Calle 1", ciudad: null }, { activa: false }]);
    expect(estado.inserts.map((i) => i.valores.accion)).toEqual(["sede_editada", "sede_desactivada"]);
  });

  it("el operario no puede escribir: ni toca la base", async () => {
    await expect(crearSede(BODEGA, ACTOR, "operario", { nombre: "Sede Sur" })).rejects.toBeInstanceOf(SedeBodegaError);
    await expect(editarSede(BODEGA, ACTOR, "operario", SEDE, { nombre: "Otra" })).rejects.toBeInstanceOf(SedeBodegaError);
    await expect(cambiarActivaSede(BODEGA, ACTOR, "operario", SEDE, false)).rejects.toBeInstanceOf(SedeBodegaError);
    expect(estado.llamadas).toBe(0);
  });

  it("rechaza nombre corto, id inválido y sede ajena", async () => {
    await expect(crearSede(BODEGA, ACTOR, "admin_bodega", { nombre: "A" })).rejects.toBeInstanceOf(SedeBodegaError);
    await expect(cambiarActivaSede(BODEGA, ACTOR, "admin_bodega", "no-uuid", false)).rejects.toBeInstanceOf(SedeBodegaError);
    estado.antes = undefined;
    await expect(cambiarActivaSede(BODEGA, ACTOR, "admin_bodega", SEDE, false)).rejects.toBeInstanceOf(SedeBodegaError);
  });
});
