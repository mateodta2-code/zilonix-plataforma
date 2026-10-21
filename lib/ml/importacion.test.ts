import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, importacionesMl, pedidos, publicaciones } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { ejecutarImportacionInicial, obtenerUltimaImportacion } from "./importacion";

function respuestaJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}
function respuestaError(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => "error" } as Response;
}

// Tarea 2.5 — prueba real contra Postgres: la importación inicial
// guarda pedidos y publicaciones reales (acá, la API de Mercado Libre
// está simulada con fetch mockeado — la prueba con la API real la
// corre Mateo en staging con un usuario de prueba, no CI) y deja el
// progreso correcto en importaciones_ml.
describe("importación inicial de Mercado Libre (tarea 2.5)", () => {
  const empresaId = randomUUID();
  const cuentaExterna = `ml-user-import-${randomUUID()}`;
  let cuentaId: string;

  // Contra la base real: CI es rápido (Postgres local), pero una
  // corrida manual contra staging por túnel SSH tiene latencia real —
  // cada importación hace varias idas y vueltas a la base.
  vi.setConfig({ testTimeout: 20_000 });

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa importación (prueba 2.5)", nit: `TEST-IMP-${empresaId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaExterna,
          nickname: "VENDEDOR_IMPORT",
          accessTokenCifrado: cifrarToken("access-vigente"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaId = cuenta.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda pedidos y publicaciones reales, y marca el progreso completo", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/orders/search")) {
        const offset = Number(new URL(url).searchParams.get("offset"));
        if (offset > 0) return respuestaJson({ results: [] }); // una sola página
        return respuestaJson({
          results: [
            { id: 111, date_created: "2026-09-01T10:00:00.000-04:00", status: "paid", total_amount: 50000, currency_id: "COP" },
            { id: 222, date_created: "2026-09-02T10:00:00.000-04:00", status: "paid", total_amount: 75000, currency_id: "COP" },
          ],
        });
      }
      if (url.includes("/items/search")) {
        const offset = Number(new URL(url).searchParams.get("offset"));
        if (offset > 0) return respuestaJson({ results: [] });
        return respuestaJson({ results: ["MCO1", "MCO2"] });
      }
      if (url.startsWith("https://api.mercadolibre.com/items?ids=")) {
        return respuestaJson([
          { code: 200, body: { id: "MCO1", title: "Camiseta", price: 50000, available_quantity: 10 } },
          { code: 200, body: { id: "MCO2", title: "Taza", price: 20000, available_quantity: 5 } },
        ]);
      }
      throw new Error(`fetch no esperado: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await ejecutarImportacionInicial(empresaId, cuentaId, cuentaExterna);

    const filasPedidos = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.cuentaMlId, cuentaId)));
    expect(filasPedidos).toHaveLength(2);
    expect(filasPedidos.map((p) => p.pedidoIdExterno).sort()).toEqual(["111", "222"]);

    const filasPublicaciones = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(publicaciones).where(eq(publicaciones.cuentaMlId, cuentaId))
    );
    expect(filasPublicaciones).toHaveLength(2);

    const progreso = await obtenerUltimaImportacion(empresaId, cuentaId);
    expect(progreso?.pedidosEncontrados).toBe(2);
    expect(progreso?.pedidosImportados).toBe(2);
    expect(progreso?.publicacionesEncontradas).toBe(2);
    expect(progreso?.publicacionesImportadas).toBe(2);
    expect(progreso?.completadoTs).not.toBeNull();
    expect(progreso?.error).toBeNull();
  });

  it("importar dos veces la misma cuenta no duplica pedidos (índice único)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/orders/search")) {
          const offset = Number(new URL(url).searchParams.get("offset"));
          if (offset > 0) return respuestaJson({ results: [] });
          return respuestaJson({
            results: [{ id: 111, date_created: "2026-09-01T10:00:00.000-04:00", status: "paid", total_amount: 50000, currency_id: "COP" }],
          });
        }
        if (url.includes("/items/search")) return respuestaJson({ results: [] });
        return respuestaJson([]);
      })
    );

    await ejecutarImportacionInicial(empresaId, cuentaId, cuentaExterna);

    const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, "111")));
    expect(filas).toHaveLength(1); // sigue siendo uno solo, no se duplicó
  });

  it("si Mercado Libre falla, la importación queda marcada con el error real, no se pierde en silencio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaError(500)));

    await ejecutarImportacionInicial(empresaId, cuentaId, cuentaExterna);

    const progreso = await obtenerUltimaImportacion(empresaId, cuentaId);
    expect(progreso?.error).toMatch(/500/);
    expect(progreso?.completadoTs).not.toBeNull(); // terminó (con error), no se quedó colgada
  });

  it("empresa B nunca ve las importaciones de empresa A", async () => {
    const empresaBId = randomUUID();
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.5)", nit: `TEST-IMPB-${empresaBId.slice(0, 8)}` })
    );
    const filas = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(importacionesMl).where(eq(importacionesMl.cuentaMlId, cuentaId)));
    expect(filas).toHaveLength(0);
  });
});
