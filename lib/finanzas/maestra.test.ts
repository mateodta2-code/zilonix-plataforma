import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, publicaciones, skus } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { guardarCostoSku } from "@/lib/costos-sku";
import { crearTercero } from "@/lib/terceros";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { FILTRO_SIN_PROVEEDOR, alertasMaestra, listarMaestraFiltrada } from "./maestra";

// Issue #128 (Z-FIN-06) — listado de la maestra (filtros en lista
// blanca) y alertas, contra Postgres real.

async function cargarMaestra() {
  const ctx = await crearDosEmpresas();
  const { empresaAId: empresaId, usuarioAId: usuarioId } = ctx;
  const base = { empresaId, usuarioId, tipo: "proveedor_producto" as const, condicionPago: "inmediato" as const };
  const infinity = await crearTercero({ ...base, nombre: "Infinity", empaque: "3000" });
  const unmerco = await crearTercero({ ...base, nombre: "Unmerco" });
  const guardar = (skuCodigo: string, datos: Parameters<typeof guardarCostoSku>[0]["datos"]) =>
    guardarCostoSku({ empresaId, usuarioId, skuCodigo, datos });
  await guardar("FUL-1", { nombreProducto: "Aspiradora", costo: "100", terceroId: infinity.id });
  await guardar("FUL-2", { nombreProducto: "Licuadora", costo: null, terceroId: infinity.id });
  await guardar("UNM-1", { nombreProducto: "Audífonos", costo: 0, terceroId: unmerco.id });
  await guardar("SUELTO", { costo: "5" });
  return { ...ctx, infinity: infinity.id, unmerco: unmerco.id };
}

describe("listado de la tabla maestra (issue #128)", () => {
  it("el filtro por proveedor muestra solo los SKU de ese tercero", async () => {
    const c = await cargarMaestra();
    const deInfinity = await listarMaestraFiltrada(c.empresaAId, { proveedor: c.infinity });
    expect(deInfinity.filas.map((f) => f.skuCodigo)).toEqual(["FUL-1", "FUL-2"]);
    expect(deInfinity.filas[0].packing).toEqual({ valor: "3000.00", origen: "proveedor", sinDato: false });

    const sinProveedor = await listarMaestraFiltrada(c.empresaAId, { proveedor: FILTRO_SIN_PROVEEDOR });
    expect(sinProveedor.filas.map((f) => f.skuCodigo)).toEqual(["SUELTO"]);
    expect(sinProveedor.filas[0].packing.sinDato).toBe(true);
  });

  it("un proveedor de otra empresa o inventado no filtra nada (lista blanca)", async () => {
    const c = await cargarMaestra();
    const deB = await crearTercero({ empresaId: c.empresaBId, usuarioId: c.usuarioBId, nombre: "De B", tipo: "otro", condicionPago: "inmediato" });
    for (const proveedor of [deB.id, randomUUID(), "' OR 1=1 --"]) {
      const resultado = await listarMaestraFiltrada(c.empresaAId, { proveedor });
      expect(resultado.filtroAplicado.proveedor).toBeUndefined();
      expect(resultado.total).toBe(4);
    }
  });

  it("búsqueda por SKU o producto y 'solo sin costo' (un costo 0 no cuenta)", async () => {
    const c = await cargarMaestra();
    expect((await listarMaestraFiltrada(c.empresaAId, { busqueda: "licua" })).filas.map((f) => f.skuCodigo)).toEqual(["FUL-2"]);
    expect((await listarMaestraFiltrada(c.empresaAId, { busqueda: "%" })).total).toBe(0);
    expect((await listarMaestraFiltrada(c.empresaAId, { soloSinCosto: "1" })).filas.map((f) => f.skuCodigo)).toEqual(["FUL-2"]);
    expect((await listarMaestraFiltrada(c.empresaBId, {})).total).toBe(0);
  });
});

describe("alertas de la tabla maestra (issue #128)", () => {
  it("lista SKU sin costo (no el costo 0), SKU publicados fuera de la maestra y publicaciones sin SKU, sin calcular utilidad", async () => {
    const c = await cargarMaestra();
    const empresaId = c.empresaAId;
    await dbComoEmpresa(empresaId, async (tx) => {
      const [cuenta] = await tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-alerta-${randomUUID()}`,
          nickname: "ALERTAS",
          accessTokenCifrado: cifrarToken("a"),
          refreshTokenCifrado: cifrarToken("r"),
          tokenExpiraTs: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: cuentasMl.id });
      const [enMaestra, fuera] = await tx
        .insert(skus)
        .values([
          { empresaId, codigo: " ful-1", nombre: "Aspiradora catálogo" },
          { empresaId, codigo: "NUEVO-9", nombre: "No cargado" },
        ])
        .returning({ id: skus.id });
      const publicacion = (n: number, skuId: string | null) => ({
        empresaId,
        cuentaMlId: cuenta.id,
        publicacionIdExterno: `MCO${n}${randomUUID().slice(0, 6)}`,
        titulo: `Pub ${n}`,
        precio: "1000",
        stock: 1,
        skuId,
      });
      await tx.insert(publicaciones).values([publicacion(1, enMaestra.id), publicacion(2, fuera.id), publicacion(3, fuera.id), publicacion(4, null)]);
    });

    const alertas = await alertasMaestra(empresaId);
    expect(alertas.sinCosto).toEqual({ total: 1, skus: [{ skuCodigo: "FUL-2", nombreProducto: "Licuadora" }] });
    expect(alertas.publicadosFueraDeMaestra).toEqual({ total: 1, skus: [{ skuCodigo: "NUEVO-9", publicaciones: 2 }] });
    expect(alertas.publicacionesSinSku).toBe(1);

    const deB = await alertasMaestra(c.empresaBId);
    expect(deB.sinCosto.total).toBe(0);
    expect(deB.publicadosFueraDeMaestra.total).toBe(0);
  });
});
