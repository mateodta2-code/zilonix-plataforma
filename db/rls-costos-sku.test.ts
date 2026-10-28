import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { auditoria, costosSku, skus } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { costosParaUtilidad, guardarCostoSku, leerCostoSku, packingEfectivo } from "../lib/costos-sku";
import { MontoInvalidoError } from "../lib/finanzas/montos";
import { TerceroNoEncontradoError, crearTercero } from "../lib/terceros";

// Issue #127 (Z-FIN-05) — tabla maestra por SKU contra Postgres real.
// Sin afirmarAislamiento(): app_user no tiene DELETE en esta tabla, así
// que el DELETE de B no da "0 filas", da error de permiso.
describe("costos_sku (RLS, issue #127)", () => {
  let contexto: ContextoDosEmpresas;
  let filaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    ({ id: filaAId } = await guardarCostoSku({
      empresaId: contexto.empresaAId,
      usuarioId: contexto.usuarioAId,
      skuCodigo: "REF-001",
      datos: { nombreProducto: "Aspiradora", costo: "45000" },
    }));
  });

  it("empresa B no ve ni edita la fila de A; A sí la edita", async () => {
    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(costosSku).where(eq(costosSku.id, filaAId)));
    expect(veB).toHaveLength(0);
    expect(await leerCostoSku(contexto.empresaBId, "REF-001")).toBeNull();

    const editadasPorB = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(costosSku).set({ costo: "1.00" }).where(eq(costosSku.id, filaAId)).returning({ id: costosSku.id })
    );
    expect(editadasPorB).toHaveLength(0);

    const editadasPorA = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(costosSku).set({ costo: "46000" }).where(eq(costosSku.id, filaAId)).returning({ costo: costosSku.costo })
    );
    expect(editadasPorA).toEqual([{ costo: "46000.00" }]);
  });

  it("con app_user, DELETE falla, aun para la empresa dueña", async () => {
    await expect(dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(costosSku).where(eq(costosSku.id, filaAId)))).rejects.toThrow(
      /permission denied/
    );
    await expect(dbComoEmpresa(contexto.empresaBId, (tx) => tx.delete(costosSku).where(eq(costosSku.id, filaAId)))).rejects.toThrow(
      /permission denied/
    );
  });

  it("dos empresas tienen el mismo sku_codigo sin mezclarse, y no hace falta que exista en skus", async () => {
    await guardarCostoSku({ empresaId: contexto.empresaBId, usuarioId: contexto.usuarioBId, skuCodigo: "REF-001", datos: { costo: "99" } });

    const enSkus = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "REF-001")));
    expect(enSkus).toHaveLength(0);

    expect((await leerCostoSku(contexto.empresaAId, "REF-001"))?.costo).toBe("46000.00");
    expect((await leerCostoSku(contexto.empresaBId, "REF-001"))?.costo).toBe("99.00");
  });

  it("dos filas del mismo SKU en una empresa fallan, también si difieren solo en mayúsculas o espacios", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(costosSku).values({ empresaId: contexto.empresaAId, skuCodigo: "REF-001" }))
    ).rejects.toThrow();
    // Sin normalizar, la base lo rechaza (CHECK): nunca queda " ref-001" al lado de "REF-001".
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(costosSku).values({ empresaId: contexto.empresaAId, skuCodigo: " ref-001" }))
    ).rejects.toThrow();

    // El helper normaliza y actualiza la misma fila.
    const { id } = await guardarCostoSku({ empresaId: contexto.empresaAId, usuarioId: contexto.usuarioAId, skuCodigo: "  ref-001 ", datos: { envioAgencia: "2000" } });
    expect(id).toBe(filaAId);
    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(costosSku).where(eq(costosSku.empresaId, contexto.empresaAId)));
    expect(filas.filter((f) => f.skuCodigo === "REF-001")).toHaveLength(1);
  });

  it("asignar a un SKU de A un tercero de B falla (clave compuesta)", async () => {
    const { id: terceroBId } = await crearTercero({
      empresaId: contexto.empresaBId,
      usuarioId: contexto.usuarioBId,
      nombre: "Proveedor de B",
      tipo: "proveedor_producto",
      condicionPago: "inmediato",
    });
    await expect(
      guardarCostoSku({ empresaId: contexto.empresaAId, usuarioId: contexto.usuarioAId, skuCodigo: "REF-001", datos: { terceroId: terceroBId } })
    ).rejects.toBeInstanceOf(TerceroNoEncontradoError);
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(costosSku).set({ terceroId: terceroBId }).where(eq(costosSku.id, filaAId)))
    ).rejects.toThrow();
    expect((await leerCostoSku(contexto.empresaAId, "REF-001"))?.terceroId).toBeNull();
  });

  it("negativos y más de 2 decimales se rechazan; precio mínimo 0 se guarda vacío; empaque y envío 0 se guardan 0.00", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    await expect(
      guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "NEG", datos: { costo: "-1" } })
    ).rejects.toBeInstanceOf(MontoInvalidoError);
    await expect(
      guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "DEC", datos: { costo: "10.005" } })
    ).rejects.toBeInstanceOf(MontoInvalidoError);
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.execute(sql`insert into costos_sku (empresa_id, sku_codigo, envio_agencia) values (${empresaAId}, 'NEG2', -5)`))
    ).rejects.toThrow();

    await guardarCostoSku({
      empresaId: empresaAId,
      usuarioId: usuarioAId,
      skuCodigo: "CEROS",
      datos: { costo: "1000", empaque: 0, envioAgencia: "0", precioMinimoUnidad: 0, precioMinimoComboX2: "0.00", precioMinimoComboX3: "0" },
    });
    const fila = await leerCostoSku(empresaAId, "CEROS");
    expect(fila?.empaque).toBe("0.00");
    expect(fila?.envioAgencia).toBe("0.00");
    expect(fila?.precioMinimoUnidad).toBeNull();
    expect(fila?.precioMinimoComboX2).toBeNull();
    expect(fila?.precioMinimoComboX3).toBeNull();

    // La base tampoco deja guardar un 0 en un precio mínimo.
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(costosSku).values({ empresaId: empresaAId, skuCodigo: "MIN0", precioMinimoUnidad: "0" }))
    ).rejects.toThrow();
  });

  it("los pisos de venta son independientes; un precio mínimo negativo se rechaza", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "COMBO", datos: { precioMinimoComboX2: "58000" } });
    const fila = await leerCostoSku(empresaAId, "COMBO");
    expect(fila?.precioMinimoUnidad).toBeNull();
    expect(fila?.precioMinimoComboX2).toBe("58000.00");

    await expect(
      guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "COMBO", datos: { precioMinimoComboX3: "-1" } })
    ).rejects.toBeInstanceOf(MontoInvalidoError);
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.execute(sql`update costos_sku set precio_minimo_combo_x3 = -1 where sku_codigo = 'COMBO'`))
    ).rejects.toThrow();
  });

  it("sin costo: sin fila o con costo vacío; costo 0.00 sí tiene costo y no alerta", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    expect((await costosParaUtilidad(empresaAId, "NO-EXISTE")).sinCosto).toBe(true);

    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "VACIO", datos: { nombreProducto: "Sin costo cargado" } });
    expect((await costosParaUtilidad(empresaAId, "VACIO")).sinCosto).toBe(true);

    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "REMATE", datos: { costo: 0 } });
    const remate = await costosParaUtilidad(empresaAId, "remate");
    expect(remate.sinCosto).toBe(false);
    expect(remate.sinCosto === false && remate.costo).toBe("0.00");
  });

  it("packing efectivo en los cuatro casos", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const { id: infinity } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Infinity", tipo: "proveedor_producto", condicionPago: "inmediato", empaque: "3000" });
    const { id: vitalcom } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Vitalcom", tipo: "proveedor_producto", condicionPago: "inmediato", empaque: "0" });
    const { id: sinPacking } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Sin packing", tipo: "proveedor_producto", condicionPago: "inmediato" });

    // 1) Valor propio del SKU gana sobre el del proveedor.
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "FUL-1", datos: { costo: "10", empaque: "1500", terceroId: infinity } });
    expect((await costosParaUtilidad(empresaAId, "FUL-1")).packing).toEqual({ valor: "1500.00", origen: "sku", sinDato: false });

    // 2) SKU vacío usa el del proveedor.
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "FUL-2", datos: { costo: "10", terceroId: infinity } });
    expect((await costosParaUtilidad(empresaAId, "FUL-2")).packing).toEqual({ valor: "3000.00", origen: "proveedor", sinDato: false });

    // 3) Proveedor con 0 = $0 real, sin aviso.
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "VIT-1", datos: { costo: "10", terceroId: vitalcom } });
    expect((await costosParaUtilidad(empresaAId, "VIT-1")).packing).toEqual({ valor: "0.00", origen: "proveedor", sinDato: false });

    // 4) SKU y proveedor vacíos, o SKU sin proveedor = sin dato.
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "SP-1", datos: { costo: "10", terceroId: sinPacking } });
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "HUERFANO", datos: { costo: "10" } });
    expect((await costosParaUtilidad(empresaAId, "SP-1")).packing.sinDato).toBe(true);
    expect((await costosParaUtilidad(empresaAId, "HUERFANO")).packing.sinDato).toBe(true);

    expect(packingEfectivo(null, null)).toEqual({ valor: "0.00", origen: "sin_dato", sinDato: true });
  });

  it("cada cambio queda en la bitácora con el valor anterior y el nuevo", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const { id } = await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "HIST", datos: { costo: "100" } });
    await guardarCostoSku({ empresaId: empresaAId, usuarioId: usuarioAId, skuCodigo: "HIST", datos: { costo: "120" }, fuente: "archivo" });

    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, id)));
    expect(filas).toHaveLength(2);
    const cambio = filas.find((f) => f.accion === "modificar");
    expect(cambio?.valorAnterior).toContain("costo=100.00");
    expect(cambio?.valorNuevo).toContain("costo=120");
    expect((await leerCostoSku(empresaAId, "HIST"))?.fuente).toBe("archivo");
  });
});
