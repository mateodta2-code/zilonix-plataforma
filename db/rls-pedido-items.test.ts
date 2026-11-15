import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { pedidoItems, publicaciones } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearVentaDePrueba, lineaDePrueba, type VentaDePrueba } from "./test-utils/venta";

// Issue #129 (Z-FIN-07) — líneas de la venta con su foto congelada.
describe("pedido_items (RLS, issue #129)", () => {
  let contexto: ContextoDosEmpresas;
  let ventaA: VentaDePrueba;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    ventaA = await crearVentaDePrueba(contexto.empresaAId, { lineas: 2 });
  });

  it("un pedido admite varias líneas; la misma línea dos veces falla", async () => {
    expect(await leer(contexto.empresaAId, ventaA.pedidoId)).toHaveLength(2);
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(contexto.empresaAId, ventaA.pedidoId, 1)))
    ).rejects.toThrow();
  });

  it("empresa B no ve ni edita las líneas de A, y DELETE falla para las dos", async () => {
    expect(await leer(contexto.empresaBId, ventaA.pedidoId)).toHaveLength(0);

    const editadasPorB = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(pedidoItems).set({ costoCongelado: "1.00" }).where(eq(pedidoItems.pedidoId, ventaA.pedidoId)).returning({ id: pedidoItems.id })
    );
    expect(editadasPorB).toHaveLength(0);

    for (const empresaId of [contexto.empresaAId, contexto.empresaBId]) {
      await expect(dbComoEmpresa(empresaId, (tx) => tx.delete(pedidoItems).where(eq(pedidoItems.pedidoId, ventaA.pedidoId)))).rejects.toThrow(
        /permission denied/
      );
    }
  });

  it("B no puede colgar una línea suya de la venta de A (clave compuesta)", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) => tx.insert(pedidoItems).values(lineaDePrueba(contexto.empresaBId, ventaA.pedidoId, 9)))
    ).rejects.toThrow();
  });

  it("costo, empaque y envío congelados: nulo se distingue de 0.00", async () => {
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .update(pedidoItems)
        .set({ costoCongelado: "0", empaqueCongelado: "0.00", envioCongelado: "0" })
        .where(and(eq(pedidoItems.pedidoId, ventaA.pedidoId), eq(pedidoItems.linea, 2)))
    );
    const [linea1, linea2] = await leer(contexto.empresaAId, ventaA.pedidoId);
    expect(linea1).toMatchObject({ costoCongelado: null, empaqueCongelado: null, envioCongelado: null, imagenUrl: null });
    expect(linea2).toMatchObject({ costoCongelado: "0.00", empaqueCongelado: "0.00", envioCongelado: "0.00" });
  });

  it("titulo queda congelado aunque cambie la publicación", async () => {
    const [publicacion] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(publicaciones)
        .values({
          empresaId: contexto.empresaAId,
          cuentaMlId: ventaA.cuentaMlId,
          publicacionIdExterno: `MCO-${ventaA.pedidoId.slice(0, 8)}`,
          titulo: "Aspiradora 1200W",
          precio: "50000.00",
          stock: 3,
        })
        .returning({ id: publicaciones.id })
    );
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .update(pedidoItems)
        .set({ publicacionId: publicacion.id, titulo: "Aspiradora 1200W", imagenUrl: "https://http2.mlstatic.com/D_prueba.jpg" })
        .where(and(eq(pedidoItems.pedidoId, ventaA.pedidoId), eq(pedidoItems.linea, 1)))
    );
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(publicaciones).set({ titulo: "Aspiradora 1500W NUEVA" }).where(eq(publicaciones.id, publicacion.id))
    );

    const [linea1] = await leer(contexto.empresaAId, ventaA.pedidoId);
    expect(linea1.titulo).toBe("Aspiradora 1200W");
    expect(linea1.imagenUrl).toBe("https://http2.mlstatic.com/D_prueba.jpg");
  });

  it("sku_codigo sin normalizar, cantidad 0 y montos negativos se rechazan", async () => {
    const base = lineaDePrueba(contexto.empresaAId, ventaA.pedidoId, 3);
    for (const malo of [{ skuCodigo: " ref-3" }, { skuCodigo: "" }, { cantidad: 0 }, { linea: 0 }, { valorLinea: "-1" }, { costoCongelado: "-0.01" }]) {
      await expect(dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(pedidoItems).values({ ...base, ...malo }))).rejects.toThrow();
    }
    // Sin SKU de ML (vacío) sí se acepta.
    await dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(pedidoItems).values({ ...base, skuCodigo: null }));
  });
});

function leer(empresaId: string, pedidoId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).orderBy(pedidoItems.linea));
}
