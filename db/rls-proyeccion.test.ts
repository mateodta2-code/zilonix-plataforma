import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas, proyeccionConfiguracion, proyeccionSku, skus } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "./test-utils/venta";
import { crearBodega } from "../lib/inventario/bodegas";
import { aplicarMovimientos } from "../lib/inventario/movimientos";
import { calcularProyeccion, guardarEntregaSku, guardarReglasProyeccion, leerReglasProyeccion } from "../lib/inventario/proyeccion-datos";
import { REGLAS_POR_DEFECTO } from "../lib/inventario/proyeccion";

// Proyección de inventarios — aislamiento de sus dos tablas y lectura
// real de stock y ventas contra Postgres (RLS no se simula).

async function crearSku(empresaId: string, codigo: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values({ empresaId, codigo, nombre: codigo }).returning({ id: skus.id }));
  return fila.id;
}

async function crearVenta(empresaId: string, skuId: string, codigo: string, cantidad: number, fecha: Date): Promise<void> {
  const cuentaMlId = await crearCuentaMlDePrueba(empresaId);
  await dbComoEmpresa(empresaId, async (tx) => {
    const [pedido] = await tx
      .insert(pedidos)
      .values({ empresaId, cuentaMlId, pedidoIdExterno: `orden-${randomUUID()}`, fecha, total: "1000.00", moneda: "COP", estado: "paid" })
      .returning({ id: pedidos.id });
    await tx.insert(pedidosFinanzas).values({ empresaId, pedidoId: pedido.id, cuentaMlId, valorVenta: "1000.00", formaEntrega: "agencia" });
    await tx.insert(pedidoItems).values({
      empresaId,
      pedidoId: pedido.id,
      linea: 1,
      itemIdExterno: "MCO1",
      skuCodigo: codigo,
      skuId,
      cantidad,
      precioUnitario: "1000.00",
      valorLinea: "1000.00",
      titulo: "Producto",
    });
  });
}

const DIA = 24 * 60 * 60 * 1000;

describe("proyección de inventarios (RLS y lectura real)", () => {
  let c: ContextoDosEmpresas;
  let skuA: string;

  beforeAll(async () => {
    c = await crearDosEmpresas();
    const { id: bodegaA } = await crearBodega(c.empresaAId, c.usuarioAId, { nombre: "Principal", tipo: "propia" });
    skuA = await crearSku(c.empresaAId, "PRY-A");
    await aplicarMovimientos(c.empresaAId, {
      claveIdempotencia: `prueba:${randomUUID()}`,
      origen: "manual",
      actor: { tipo: "persona", usuarioId: c.usuarioAId },
      lineas: [{ tipo: "entrada", bodegaId: bodegaA, skuId: skuA, cantidad: 100 }],
    });
    // 10 vendidas hoy y 20 hace 10 días: entran en 14 d, 20 d y 30 d, pero no en 3 d ni 7 d.
    await crearVenta(c.empresaAId, skuA, "PRY-A", 10, new Date());
    await crearVenta(c.empresaAId, skuA, "PRY-A", 20, new Date(Date.now() - 10 * DIA));
    await guardarReglasProyeccion(c.empresaAId, c.usuarioAId, { ...REGLAS_POR_DEFECTO, coberturaDias: 45 });
    await guardarEntregaSku(c.empresaAId, c.usuarioAId, { skuId: skuA, ruta: "avion", leadTimeDias: 28 });
  });

  it("proyeccion_configuracion y proyeccion_sku: B no ve las filas de A", async () => {
    for (const tabla of [proyeccionConfiguracion, proyeccionSku]) {
      const deA = await dbComoEmpresa(c.empresaAId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.empresaId, c.empresaAId)));
      expect(deA.length).toBeGreaterThan(0);
      const veB = await dbComoEmpresa(c.empresaBId, (tx) => tx.select({ id: tabla.id }).from(tabla).where(eq(tabla.empresaId, c.empresaAId)));
      expect(veB).toHaveLength(0);
      const editadas = await dbComoEmpresa(c.empresaBId, (tx) =>
        tx.update(tabla).set({ empresaId: c.empresaBId } as never).where(eq(tabla.empresaId, c.empresaAId)).returning({ id: tabla.id })
      );
      expect(editadas).toHaveLength(0);
    }
  });

  it("B no puede guardar días de entrega de un SKU de A", async () => {
    await expect(guardarEntregaSku(c.empresaBId, c.usuarioBId, { skuId: skuA, ruta: "nacional", leadTimeDias: 3 })).rejects.toThrow();
  });

  it("una empresa sin reglas usa las de por defecto; la otra, las suyas", async () => {
    expect(await leerReglasProyeccion(c.empresaBId)).toEqual(REGLAS_POR_DEFECTO);
    expect((await leerReglasProyeccion(c.empresaAId)).coberturaDias).toBe(45);
  });

  it("calcula con el stock y las ventas reales, por ventana, y la empresa B no ve nada", async () => {
    const { filas } = await calcularProyeccion(c.empresaAId, { ventanaDias: 14 });
    const f = filas.find((x) => x.skuId === skuA);
    expect(f).toBeDefined();
    expect(f!.stock).toBe(100);
    expect(f!.vendidas30).toBe(30);
    // 30 vendidas en 14 d = 2,14 por día; 100 ÷ 2,14 ≈ 46,7 días.
    expect(f!.velocidad).toBeCloseTo(30 / 14, 5);
    expect(f!.velocidadPorVentana[3]).toBeCloseTo(10 / 3, 5);
    expect(f!.velocidadPorVentana[7]).toBeCloseTo(10 / 7, 5);
    // Los días propios (28) mandan sobre los de avión (25).
    expect(f!.ruta).toBe("avion");
    expect(f!.leadTimeDias).toBe(28);

    const deB = await calcularProyeccion(c.empresaBId);
    expect(deB.filas).toHaveLength(0);
  });
});
