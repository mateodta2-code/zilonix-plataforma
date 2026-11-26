import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db";
import { auditoria, empresas, stockBodega3pl, usuarios } from "@/db/schema";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { cambiarEstadoVinculo, crearBodega, ligarEmpresaABodega } from "@/lib/superadmin-bodegas";
import { listarStockBodega, listarStockDeEmpresa } from "./inventario";
import { RecepcionInvalidaError, interpretarLineas, listarRecepciones, listarRecepcionesDeEmpresa, registrarRecepcion } from "./recepcion";

describe("interpretarLineas", () => {
  it("acepta espacio, coma, tabulador y suma SKU repetidos", () => {
    expect(interpretarLineas("A-1 10\nB-2,5\r\nC-3\t7\nA-1 2\n\n")).toEqual([
      { sku: "A-1", cantidad: 12 },
      { sku: "B-2", cantidad: 5 },
      { sku: "C-3", cantidad: 7 },
    ]);
  });
  it("rechaza 0, negativas, decimales, renglones incompletos y texto vacío", () => {
    for (const malo of ["A 0", "A -3", "A 1.5", "A", "A 1 2", "", "  \n "]) expect(() => interpretarLineas(malo), malo).toThrow(RecepcionInvalidaError);
  });
});

// Contra Postgres real: suma de stock, auditoría y aislamiento A/B. No usa
// afirmarAislamiento (app_user no tiene UPDATE/DELETE en estas tablas).
describe("recepción e inventario de bodega 3PL (issue #626)", () => {
  const sufijo = randomUUID().slice(0, 8);
  const superadminId = randomUUID();
  const operarioId = randomUUID();
  let bodegaA: string;
  let bodegaB: string;
  let empresaA: string;
  let empresaB: string;
  let empresaC: string;

  beforeAll(async () => {
    await db.insert(usuarios).values({ id: superadminId, email: `rec-${sufijo}@zilonix.test`, nombre: "Superadmin recepción", esSuperadmin: true });
    await db.insert(usuarios).values({ id: operarioId, email: `rec-op-${sufijo}@zilonix.test`, nombre: "Operario recepción" });
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
    empresaC = randomUUID();
    await dbComoEmpresa(empresaC, (tx) => tx.insert(empresas).values({ id: empresaC, nombre: `Empresa C ${sufijo}`, nit: `TEST-REC-C-${sufijo}` }));
    bodegaA = (await crearBodega(superadminId, { nombre: `Bodega rec A ${sufijo}`, nit: "" })).id;
    bodegaB = (await crearBodega(superadminId, { nombre: `Bodega rec B ${sufijo}`, nit: "" })).id;
    await ligarEmpresaABodega(superadminId, bodegaA, empresaA);
    await ligarEmpresaABodega(superadminId, bodegaB, empresaB);
  });

  it("una recepción de 3 SKU suma su stock, y una segunda lo acumula; queda auditoría", async () => {
    const lineas = [{ sku: "S1", cantidad: 5 }, { sku: "S2", cantidad: 3 }, { sku: "S3", cantidad: 1 }];
    const { recepcionId } = await registrarRecepcion(bodegaA, operarioId, { empresaId: empresaA, nota: "primera", lineas }, "operario");
    await registrarRecepcion(bodegaA, operarioId, { empresaId: empresaA, lineas: [{ sku: "S1", cantidad: 4 }] }, "operario");
    const stock = await listarStockBodega(bodegaA);
    expect(Object.fromEntries(stock.map((f) => [f.sku, f.cantidad]))).toEqual({ S1: 9, S2: 3, S3: 1 });
    const aud = await dbComoBodega(bodegaA, (tx) => tx.select().from(auditoria).where(and(eq(auditoria.bodegaId, bodegaA), eq(auditoria.entidadId, recepcionId))));
    expect(aud.map((a) => a.accion)).toEqual(["bodega.recepcion.registrar"]);
    const lista = await listarRecepciones(bodegaA, { empresaId: empresaA });
    expect(lista).toHaveLength(2);
    expect(lista.find((r) => r.id === recepcionId)).toMatchObject({ lineas: 3, unidades: 9, nota: "primera" });
  });

  it("cantidades 0 o negativas no se guardan y nada queda a medias", async () => {
    for (const cantidad of [0, -2]) {
      await expect(registrarRecepcion(bodegaA, operarioId, { empresaId: empresaA, lineas: [{ sku: "MALO", cantidad }] }, "operario")).rejects.toBeInstanceOf(RecepcionInvalidaError);
    }
    expect((await listarStockBodega(bodegaA, { busqueda: "MALO" }))).toHaveLength(0);
  });

  it("empresa no ligada o pausada se rechaza; al reactivar vuelve a funcionar", async () => {
    await expect(registrarRecepcion(bodegaA, operarioId, { empresaId: empresaC, lineas: [{ sku: "X", cantidad: 1 }] }, "operario")).rejects.toBeInstanceOf(RecepcionInvalidaError);
    await expect(registrarRecepcion(bodegaA, operarioId, { empresaId: empresaB, lineas: [{ sku: "X", cantidad: 1 }] }, "operario")).rejects.toBeInstanceOf(RecepcionInvalidaError);
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "pausada");
    await expect(registrarRecepcion(bodegaA, operarioId, { empresaId: empresaA, lineas: [{ sku: "X", cantidad: 1 }] }, "operario")).rejects.toBeInstanceOf(RecepcionInvalidaError);
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "activa");
    await registrarRecepcion(bodegaA, operarioId, { empresaId: empresaA, lineas: [{ sku: "X", cantidad: 1 }] }, "operario");
  });

  it("A/B: cada bodega ve solo lo suyo y cada vendedor solo su stock", async () => {
    await registrarRecepcion(bodegaB, operarioId, { empresaId: empresaB, lineas: [{ sku: "B1", cantidad: 2 }] }, "operario");
    expect((await listarStockBodega(bodegaB)).map((f) => f.sku)).toEqual(["B1"]);
    expect((await listarStockBodega(bodegaA)).map((f) => f.sku)).not.toContain("B1");
    expect((await listarRecepciones(bodegaB)).every((r) => r.empresaId === empresaB)).toBe(true);
    expect((await listarStockDeEmpresa(empresaB)).map((f) => f.sku)).toEqual(["B1"]);
    expect((await listarStockDeEmpresa(empresaA)).map((f) => f.sku)).not.toContain("B1");
    expect(await listarStockDeEmpresa(empresaC)).toHaveLength(0);
    expect((await listarRecepcionesDeEmpresa(empresaA)).every((r) => r.empresaId === empresaA)).toBe(true);
  });

  it("la empresa no escribe: UPDATE filtrado a 0 filas, INSERT rechazado; una bodega no toca el stock de otra", async () => {
    expect(await dbComoEmpresa(empresaA, (tx) => tx.update(stockBodega3pl).set({ cantidad: 999 }).returning({ id: stockBodega3pl.id }))).toHaveLength(0);
    await expect(dbComoEmpresa(empresaA, (tx) => tx.insert(stockBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, sku: "HACK", cantidad: 1 }))).rejects.toThrow();
    expect(await dbComoBodega(bodegaB, (tx) => tx.update(stockBodega3pl).set({ cantidad: 999 }).where(eq(stockBodega3pl.bodegaId, bodegaA)).returning({ id: stockBodega3pl.id }))).toHaveLength(0);
    expect((await listarStockBodega(bodegaA, { busqueda: "S1" }))[0].cantidad).toBe(9);
  });

  it("el buscador trata % y _ como texto", async () => {
    expect(await listarStockBodega(bodegaA, { busqueda: "%" })).toHaveLength(0);
  });
});
