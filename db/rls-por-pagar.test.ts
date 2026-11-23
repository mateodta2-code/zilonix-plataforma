import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./index";
import { dbComoEmpresa } from "./empresa-context";
import { ordenesCompra, skus, usuarios } from "./schema";
import { crearEmpresaConDueno } from "../lib/empresas";
import { validarGasto } from "../lib/finanzas/gastos";
import { crearGasto, listarCategoriasGasto } from "../lib/finanzas/gastos-db";
import { leerPorPagar, marcarOrdenCompraPagada, OrdenCompraNoEncontradaError } from "../lib/finanzas/por-pagar-db";
import { crearBodega } from "../lib/inventario/bodegas";
import { crearOrdenCompra } from "../lib/inventario/compras";
import { crearTercero } from "../lib/terceros";

// Issue #422 (fase 5 de Finanzas) — cuentas por pagar contra Postgres
// real con app_user: una empresa nunca ve ni paga los gastos u órdenes
// de compra de otra, y los totales salen bien del agregado en SQL.

const HOY = "2026-11-20";
const SIN_FILTROS = { origen: null, estado: null, proveedor: null };

async function nuevoUsuario(etiqueta: string): Promise<string> {
  const [u] = await db
    .insert(usuarios)
    .values({ email: `prueba-por-pagar-${etiqueta}-${randomUUID()}@zilonix.test`, nombre: `Usuario ${etiqueta} (por pagar)` })
    .returning({ id: usuarios.id });
  return u.id;
}

async function gasto(empresaId: string, usuarioId: string, categoriaId: string, monto: string, fechaVencimiento: string, extra: { terceroId?: string } = {}) {
  return crearGasto({
    empresaId,
    usuarioId,
    datos: validarGasto({
      tienda: "",
      categoriaId,
      terceroId: extra.terceroId ?? "",
      beneficiario: extra.terceroId ? "" : "Arrendador",
      descripcion: `Gasto ${monto}`,
      monto,
      fechaGasto: "2026-11-01",
      fechaVencimiento,
      pagado: false,
      fechaPago: "",
      medioPago: "",
      soporte: "",
    }),
  });
}

async function ordenConCosto(empresaId: string, usuarioId: string, terceroId: string | null, costo: string) {
  const { id: bodegaId } = await crearBodega(empresaId, usuarioId, { nombre: `Bodega ${randomUUID().slice(0, 6)}`, tipo: "propia" });
  const [sku] = await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(skus).values({ empresaId, codigo: `PP-${randomUUID().slice(0, 6)}`, nombre: "SKU" }).returning({ id: skus.id })
  );
  return crearOrdenCompra(empresaId, usuarioId, { terceroId, bodegaDestinoId: bodegaId, nota: null, lineas: [{ skuId: sku.id, cantidad: 2, costoUnitario: costo }] });
}

describe("cuentas por pagar (RLS, issue #422)", () => {
  let usuarioA: string;
  let usuarioB: string;
  let empresaA: string;
  let empresaB: string;
  let ordenA: string;
  let terceroA: string;

  beforeAll(async () => {
    usuarioA = await nuevoUsuario("a");
    usuarioB = await nuevoUsuario("b");
    empresaA = await crearEmpresaConDueno(usuarioA, "Empresa A (por pagar)", `TEST-PPA-${randomUUID().slice(0, 8)}`);
    empresaB = await crearEmpresaConDueno(usuarioB, "Empresa B (por pagar)", `TEST-PPB-${randomUUID().slice(0, 8)}`);
    const categoriaA = (await listarCategoriasGasto(empresaA, usuarioA)).find((c) => c.nombre === "Arriendo")!.id;
    const categoriaB = (await listarCategoriasGasto(empresaB, usuarioB)).find((c) => c.nombre === "Arriendo")!.id;
    ({ id: terceroA } = await crearTercero({ empresaId: empresaA, usuarioId: usuarioA, nombre: "Proveedor A", tipo: "otro", empaque: null, condicionPago: "inmediato" }));

    await gasto(empresaA, usuarioA, categoriaA, "100", "2026-11-10"); // vencido
    await gasto(empresaA, usuarioA, categoriaA, "200", "2026-11-25"); // vence en 7 días
    await gasto(empresaA, usuarioA, categoriaA, "300", "2026-12-31", { terceroId: terceroA }); // después
    ({ id: ordenA } = await ordenConCosto(empresaA, usuarioA, terceroA, "500")); // 2 × 500, sin vencimiento
    await gasto(empresaB, usuarioB, categoriaB, "99999", "2026-11-10");
    await ordenConCosto(empresaB, usuarioB, null, "88888");
  });

  it("A ve solo lo suyo, con los totales por vencimiento calculados en SQL", async () => {
    const { filas, totales } = await leerPorPagar(empresaA, usuarioA, SIN_FILTROS, HOY);
    expect(filas).toHaveLength(4);
    expect(totales).toHaveLength(1);
    expect(totales[0]).toMatchObject({ total: "1600.00", vencido: "100.00", porVencer: "200.00", despues: "1300.00", partidas: 4 });
    expect(filas.find((f) => f.origen === "orden")).toMatchObject({ id: ordenA, concepto: expect.stringMatching(/^OC-\d+$/), valor: "1000.00", estado: "al_dia" });
  });

  it("los filtros por origen, estado y proveedor se aplican también a los totales", async () => {
    const soloOrdenes = await leerPorPagar(empresaA, usuarioA, { ...SIN_FILTROS, origen: "orden" }, HOY);
    expect(soloOrdenes.totales[0].total).toBe("1000.00");
    const vencidos = await leerPorPagar(empresaA, usuarioA, { ...SIN_FILTROS, estado: "vencido" }, HOY);
    expect(vencidos.filas.map((f) => f.valor)).toEqual(["100.00"]);
    const delTercero = await leerPorPagar(empresaA, usuarioA, { ...SIN_FILTROS, proveedor: { tipo: "tercero", id: terceroA } }, HOY);
    expect(delTercero.totales[0].total).toBe("1300.00");
    const delBeneficiario = await leerPorPagar(empresaA, usuarioA, { ...SIN_FILTROS, proveedor: { tipo: "beneficiario", nombre: "Arrendador" } }, HOY);
    expect(delBeneficiario.totales[0].total).toBe("300.00");
  });

  it("B no ve las partidas de A ni puede marcar pagada su orden", async () => {
    const deB = await leerPorPagar(empresaB, usuarioB, SIN_FILTROS, HOY);
    expect(deB.filas.every((f) => f.valor !== "1000.00" && f.valor !== "100.00")).toBe(true);
    expect(deB.totales[0].total).toBe("277775.00");
    await expect(marcarOrdenCompraPagada({ empresaId: empresaB, usuarioId: usuarioB, ordenId: ordenA, fechaPago: HOY, medioPago: "" })).rejects.toThrow(
      OrdenCompraNoEncontradaError
    );
    // Directo contra la tabla: la fila de A no existe para B.
    const editadas = await dbComoEmpresa(empresaB, (tx) =>
      tx.update(ordenesCompra).set({ fechaPago: HOY }).where(eq(ordenesCompra.id, ordenA)).returning({ id: ordenesCompra.id })
    );
    expect(editadas).toHaveLength(0);
  });

  it("marcar pagada la orden la guarda en ordenes_compra y sale de por pagar; no se paga dos veces", async () => {
    await marcarOrdenCompraPagada({ empresaId: empresaA, usuarioId: usuarioA, ordenId: ordenA, fechaPago: HOY, medioPago: "Transferencia" });
    const [orden] = await dbComoEmpresa(empresaA, (tx) => tx.select().from(ordenesCompra).where(eq(ordenesCompra.id, ordenA)));
    expect(orden).toMatchObject({ fechaPago: HOY, medioPago: "Transferencia", estado: "abierta" });
    const { totales } = await leerPorPagar(empresaA, usuarioA, SIN_FILTROS, HOY);
    expect(totales[0].total).toBe("600.00");
    await expect(marcarOrdenCompraPagada({ empresaId: empresaA, usuarioId: usuarioA, ordenId: ordenA, fechaPago: HOY, medioPago: "" })).rejects.toThrow(
      OrdenCompraNoEncontradaError
    );
  });

  it("un medio de pago sin fecha de pago no se acepta en la base", async () => {
    await expect(dbComoEmpresa(empresaA, (tx) => tx.update(ordenesCompra).set({ fechaPago: null, medioPago: "Efectivo" }).where(eq(ordenesCompra.id, ordenA)))).rejects.toThrow();
  });
});
