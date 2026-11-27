import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const registro: { inserts: { tabla: string; valores: Record<string, unknown> }[]; usuario?: string; bodega?: string; falla?: unknown } = { inserts: [] };

vi.mock("@/db/bodega-context", () => ({
  dbComoAutorregistroBodega: async (usuarioId: string, bodegaId: string, fn: (tx: unknown) => Promise<unknown>) => {
    registro.usuario = usuarioId;
    registro.bodega = bodegaId;
    const tx = {
      insert: (tabla: object) => ({
        values: async (valores: Record<string, unknown>) => {
          if (registro.falla && getTableName(tabla as never) === "bodegas_3pl") throw registro.falla;
          registro.inserts.push({ tabla: getTableName(tabla as never), valores });
        },
      }),
    };
    return fn(tx);
  },
  dbComoUsuarioBodega: async () => false,
}));

import { AutorregistroBodegaError, MAX_INTENTOS_POR_IP, MAX_INTENTOS_POR_USUARIO, MENSAJE_YA_REGISTRADA, crearBodegaAutorregistro, reiniciarLimitesAutorregistro, superaLimiteAutorregistro } from "./autorregistro";

const USUARIO = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  registro.inserts = [];
  registro.falla = undefined;
  reiniciarLimitesAutorregistro();
});

describe("crearBodegaAutorregistro", () => {
  it("camino feliz: bodega activa de autorregistro, admin, primera sede y dos filas de auditoría", async () => {
    const { bodegaId } = await crearBodegaAutorregistro(USUARIO, { nombre: "  Bodega Norte ", nit: "900", sede: { nombre: "Sede Centro", ciudad: "Bogotá" } });
    expect(registro.usuario).toBe(USUARIO);
    expect(registro.bodega).toBe(bodegaId);
    const tablas = registro.inserts.map((i) => i.tabla);
    expect(tablas).toEqual(["bodegas_3pl", "miembros_bodega_3pl", "sedes_bodega", "auditoria", "auditoria"]);
    expect(registro.inserts[0].valores).toMatchObject({ id: bodegaId, nombre: "Bodega Norte", nit: "900", origen: "autorregistro", estado: "activa", creadoPor: USUARIO });
    expect(registro.inserts[1].valores).toMatchObject({ rol: "admin_bodega", usuarioId: USUARIO, bodegaId });
    expect(registro.inserts[2].valores).toMatchObject({ nombre: "Sede Centro", ciudad: "Bogotá", direccion: null, bodegaId });
    expect(registro.inserts[3].valores).toMatchObject({ accion: "bodega_autorregistro", entidad: "bodega_3pl", bodegaId });
    expect(registro.inserts[4].valores).toMatchObject({ accion: "sede_creada", entidad: "sede_bodega", bodegaId });
  });

  it("sede sin nombre usa «Sede principal»", async () => {
    await crearBodegaAutorregistro(USUARIO, { nombre: "Bodega", sede: { nombre: "  " } });
    expect(registro.inserts[2].valores).toMatchObject({ nombre: "Sede principal" });
  });

  it("quien ya es vendedor o domiciliario también puede registrar su bodega (no se consulta nada de eso)", async () => {
    await expect(crearBodegaAutorregistro(USUARIO, { nombre: "Bodega Dos", sede: { nombre: "Principal" } })).resolves.toHaveProperty("bodegaId");
  });

  it("si ya tiene una (índice único) responde con el mensaje claro", async () => {
    registro.falla = Object.assign(new Error("duplicate"), { code: "23505" });
    await expect(crearBodegaAutorregistro(USUARIO, { nombre: "Otra", sede: { nombre: "Sede" } })).rejects.toThrow(MENSAJE_YA_REGISTRADA);
  });

  it("nombre inválido: no inserta nada", async () => {
    await expect(crearBodegaAutorregistro(USUARIO, { nombre: "A", sede: { nombre: "Sede" } })).rejects.toBeInstanceOf(AutorregistroBodegaError);
    await expect(crearBodegaAutorregistro(USUARIO, { nombre: "x".repeat(81), sede: { nombre: "Sede" } })).rejects.toBeInstanceOf(AutorregistroBodegaError);
    await expect(crearBodegaAutorregistro(USUARIO, { nombre: "Bodega", sede: { nombre: "S".repeat(81) } })).rejects.toBeInstanceOf(AutorregistroBodegaError);
    expect(registro.inserts).toHaveLength(0);
  });
});

describe("superaLimiteAutorregistro", () => {
  it("máximo 5 intentos por hora por usuario", () => {
    for (let i = 0; i < MAX_INTENTOS_POR_USUARIO; i++) expect(superaLimiteAutorregistro(USUARIO, `ip-${i}`, 1000)).toBe(false);
    expect(superaLimiteAutorregistro(USUARIO, "ip-x", 1000)).toBe(true);
    // pasada la hora, vuelve a dejar
    expect(superaLimiteAutorregistro(USUARIO, "ip-y", 1000 + 60 * 60 * 1000 + 1)).toBe(false);
  });

  it("máximo 20 intentos por hora por IP, aunque sean usuarios distintos", () => {
    for (let i = 0; i < MAX_INTENTOS_POR_IP; i++) expect(superaLimiteAutorregistro(`u-${i}`, "1.2.3.4", 1000)).toBe(false);
    expect(superaLimiteAutorregistro("u-otro", "1.2.3.4", 1000)).toBe(true);
  });
});
