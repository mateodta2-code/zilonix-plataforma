import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, costosSku, skus, terceros } from "@/db/schema";
import { costosParaUtilidad, leerCostoSku } from "@/lib/costos-sku";
import { SinPermisoError } from "@/lib/permisos";
import { actualizarTercero, crearTercero } from "@/lib/terceros";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import type { FilaArchivo } from "@/lib/importar-archivo";
import { crearXlsxDePrueba, type ValorCeldaPrueba } from "@/lib/test-utils/xlsx";
import {
  ArchivoMaestraInvalidoError,
  FILAS_MAXIMAS_MAESTRA,
  ImportacionMaestraConErroresError,
  calcularVistaPrevia,
  confirmarImportacionMaestra,
  previsualizarImportacionMaestra,
  puedeConfirmar,
} from "./maestra-importar";

// Issue #128 (Z-FIN-06) — criterios de aceptación de la carga de la
// tabla maestra, contra Postgres real. Datos de ejemplo inventados.

const ENCABEZADO_ZILONIX: ValorCeldaPrueba[] = [
  "PRODUCTO",
  "PROVEEDOR",
  "SKU",
  "Costo producto",
  "packing",
  "envio agencia",
  "Precio minimo venta 1",
  "Precio minimo venta 2",
  "Precio minimo venta 3",
];

const xlsx = (filas: ValorCeldaPrueba[][]) => ({ nombre: "maestra.xlsx", contenido: crearXlsxDePrueba([ENCABEZADO_ZILONIX, ...filas]) });
const csv = (lineas: string[]) => ({ nombre: "maestra.csv", contenido: Buffer.from(lineas.join("\n"), "utf8") });

async function empresaConProveedores() {
  const { empresaId, usuarioId } = await crearEmpresaConPermisos("Maestra importar", [
    { modulo: "finanzas", accion: "consultar" },
    { modulo: "finanzas", accion: "modificar" },
  ]);
  const base = { empresaId, usuarioId, tipo: "proveedor_producto" as const, condicionPago: "inmediato" as const };
  const infinity = await crearTercero({ ...base, nombre: "Infinity", empaque: "3000" });
  const unmerco = await crearTercero({ ...base, nombre: "Unmerco", empaque: "2000" });
  const vitalcom = await crearTercero({ ...base, nombre: "Vitalcom", empaque: "0" });
  return { empresaId, usuarioId, infinity: infinity.id, unmerco: unmerco.id, vitalcom: vitalcom.id };
}

describe("carga de la tabla maestra (issue #128)", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("la hoja de Zilonix (.xlsx) se carga con las reglas de ceros y packing", async () => {
    const e = await empresaConProveedores();
    const archivo = xlsx([
      ["Aspiradora", "Infinity", "FUL-001", 45000, 3000, 2000, 60000, 0, 0],
      ["Audífonos", "Unmerco", "unm-002", 0, null, 0, 0, 52000, null],
      ["Camiseta", "Vitalcom", " ref-003 ", null, 2000, null, 35000, null, 90000],
    ]);

    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo);
    expect(vista.errores).toEqual([]);
    expect(vista.resumen.nuevas).toBe(3);
    expect(vista.mapeo).toMatchObject({ producto: 0, proveedor: 1, sku: 2, costo: 3, empaque: 4, envio_agencia: 5, precio_minimo_unidad: 6, precio_minimo_combo_x2: 7, precio_minimo_combo_x3: 8 });
    // Costo vacío avisa; costo 0 no.
    expect(vista.filas.find((f) => f.sku === "REF-003")?.avisos.join(" ")).toContain("Sin costo");
    expect(vista.filas.find((f) => f.sku === "UNM-002")?.avisos.join(" ") ?? "").not.toContain("Sin costo");
    // Packing distinto al del proveedor queda marcado.
    expect(vista.filas.find((f) => f.sku === "REF-003")?.avisos.join(" ")).toContain("Packing distinto");
    expect(puedeConfirmar(vista)).toBe(true);

    expect(await confirmarImportacionMaestra(e.empresaId, e.usuarioId, archivo)).toEqual({ nuevas: 3, actualizadas: 0, sinCambios: 0, proveedoresCreados: 0 });

    const ful = await leerCostoSku(e.empresaId, "FUL-001");
    expect(ful).toMatchObject({ costo: "45000.00", empaque: null, envioAgencia: "2000.00", precioMinimoUnidad: "60000.00", precioMinimoComboX2: null, precioMinimoComboX3: null, terceroId: e.infinity, fuente: "archivo" });
    const unm = await leerCostoSku(e.empresaId, "UNM-002");
    expect(unm).toMatchObject({ costo: "0.00", empaque: null, envioAgencia: "0.00", precioMinimoUnidad: null, precioMinimoComboX2: "52000.00" });
    const ref = await leerCostoSku(e.empresaId, "REF-003");
    expect(ref).toMatchObject({ costo: null, empaque: "2000.00", precioVenta: null, precioMinimoComboX3: "90000.00" });

    expect((await costosParaUtilidad(e.empresaId, "UNM-002")).sinCosto).toBe(false);
    expect((await costosParaUtilidad(e.empresaId, "REF-003")).sinCosto).toBe(true);
    expect((await costosParaUtilidad(e.empresaId, "FUL-001")).packing).toEqual({ valor: "3000.00", origen: "proveedor", sinDato: false });
  });

  it("un SKU que no está en `skus` entra como nueva y no se crea nada en `skus`", async () => {
    const e = await empresaConProveedores();
    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo", "SOLO-MAESTRA,100"]));
    expect(vista.filas[0]).toMatchObject({ sku: "SOLO-MAESTRA", estado: "nueva" });
    await confirmarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo", "SOLO-MAESTRA,100"]));
    const enSkus = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(skus).where(eq(skus.empresaId, e.empresaId)));
    expect(enSkus).toHaveLength(0);
  });

  it("una fila inválida muestra fila y motivo, y no se guarda ninguna", async () => {
    const e = await empresaConProveedores();
    const archivo = csv(["sku,proveedor,costo", "BUENO-1,Infinity,100", "MALO-1,Infinity,abc", "BUENO-2,,200"]);
    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo);
    expect(vista.errores).toEqual([expect.objectContaining({ numeroFila: 3, columna: "Costo" })]);
    expect(puedeConfirmar(vista)).toBe(false);

    await expect(confirmarImportacionMaestra(e.empresaId, e.usuarioId, archivo)).rejects.toBeInstanceOf(ImportacionMaestraConErroresError);
    const guardadas = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(costosSku).where(eq(costosSku.empresaId, e.empresaId)));
    expect(guardadas).toHaveLength(0);
  });

  it("el mismo SKU en dos filas (también por mayúsculas o espacios) se rechaza indicando ambas", async () => {
    const e = await empresaConProveedores();
    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo", "ref-9,1", "OTRO,2", " REF-9 ,3"]));
    const deRef9 = vista.errores.filter((x) => x.mensaje.includes("REF-9"));
    expect(deRef9.map((x) => x.numeroFila)).toEqual([2, 4]);
    expect(deRef9[0].mensaje).toContain("2, 4");
    expect(puedeConfirmar(vista)).toBe(false);
  });

  it("un proveedor que no existe se crea al confirmar (uno solo por nombre), con bitácora; una segunda carga no lo duplica", async () => {
    const e = await empresaConProveedores();
    const archivo = csv(["sku,proveedor,costo", "N-1,Proveedor  Nuevo,10", "N-2,proveedor nuevo,20", "N-3,Infinity,30"]);
    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo);
    expect(vista.errores).toEqual([]);
    expect(vista.resumen.proveedoresNuevos).toBe(1);
    expect(vista.filas.find((f) => f.sku === "N-2")?.avisos).toContain("Se creará el proveedor «Proveedor Nuevo».");
    // La vista previa no escribe.
    const antes = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(terceros).where(eq(terceros.nombre, "Proveedor Nuevo")));
    expect(antes).toHaveLength(0);

    expect(await confirmarImportacionMaestra(e.empresaId, e.usuarioId, archivo)).toEqual({ nuevas: 3, actualizadas: 0, sinCambios: 0, proveedoresCreados: 1 });
    const creados = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(terceros).where(eq(terceros.nombre, "Proveedor Nuevo")));
    expect(creados).toHaveLength(1);
    expect(creados[0]).toMatchObject({
      tipo: "proveedor_producto",
      condicionPago: "inmediato",
      periodicidad: null,
      empaque: null,
      plazoDias: null,
      activo: true,
      actualizadoPor: e.usuarioId,
      predeterminadoEmpaque: false,
    });
    expect((await leerCostoSku(e.empresaId, "N-1"))?.terceroId).toBe(creados[0].id);
    expect((await leerCostoSku(e.empresaId, "N-2"))?.terceroId).toBe(creados[0].id);
    const bitacora = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, creados[0].id)));
    expect(bitacora).toEqual([
      expect.objectContaining({ accion: "crear", entidad: "tercero", detalle: "Creó el tercero «Proveedor Nuevo» (desde importación maestra)." }),
    ]);

    // Segunda carga con el mismo nombre (otras mayúsculas): usa el que ya existe.
    const otra = csv(["sku,proveedor,costo", "N-4,PROVEEDOR NUEVO,40"]);
    expect((await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, otra)).resumen.proveedoresNuevos).toBe(0);
    expect((await confirmarImportacionMaestra(e.empresaId, e.usuarioId, otra)).proveedoresCreados).toBe(0);
    expect((await leerCostoSku(e.empresaId, "N-4"))?.terceroId).toBe(creados[0].id);
    const todos = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(terceros).where(eq(terceros.empresaId, e.empresaId)));
    expect(todos.filter((t) => t.nombre.toLowerCase() === "proveedor nuevo")).toHaveLength(1);
  });

  it("si el proveedor se crea a mano entre la vista previa y la confirmación, se usa ese y no se duplica", async () => {
    const e = await empresaConProveedores();
    const archivo = csv(["sku,proveedor,costo", "R-1,Carrera,10"]);
    expect((await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo)).resumen.proveedoresNuevos).toBe(1);
    const aMano = await crearTercero({ empresaId: e.empresaId, usuarioId: e.usuarioId, nombre: "Carrera", tipo: "proveedor_producto", condicionPago: "inmediato" });
    expect((await confirmarImportacionMaestra(e.empresaId, e.usuarioId, archivo)).proveedoresCreados).toBe(0);
    expect((await leerCostoSku(e.empresaId, "R-1"))?.terceroId).toBe(aMano.id);
  });

  it("el proveedor creado por A no existe para B (A/B)", async () => {
    const a = await empresaConProveedores();
    const b = await empresaConProveedores();
    await confirmarImportacionMaestra(a.empresaId, a.usuarioId, csv(["sku,proveedor,costo", "AB-1,Solo De A,10"]));
    const deB = await dbComoEmpresa(b.empresaId, (tx) => tx.select().from(terceros).where(eq(terceros.nombre, "Solo De A")));
    expect(deB).toHaveLength(0);
    // Para B sigue siendo un proveedor por crear.
    const vistaB = await previsualizarImportacionMaestra(b.empresaId, b.usuarioId, csv(["sku,proveedor,costo", "AB-1,Solo De A,10"]));
    expect(vistaB.resumen.proveedoresNuevos).toBe(1);
  });

  it("costo: vacío no pisa uno guardado, 0 lo cambia a 0.00 como cambio (CSV y .xlsx)", async () => {
    const e = await empresaConProveedores();
    await confirmarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo,envio agencia", "C-1,500,100", "C-2,600,100"]));

    // CSV: celda vacía en C-1, "0" en C-2.
    const vistaCsv = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo,envio agencia", "C-1,,", "C-2,0,"]));
    expect(vistaCsv.filas.find((f) => f.sku === "C-1")?.estado).toBe("sin_cambios");
    expect(vistaCsv.filas.find((f) => f.sku === "C-2")?.cambios).toEqual([{ campo: "costo", anterior: "600.00", nuevo: "0" }]);
    await confirmarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,costo,envio agencia", "C-1,,", "C-2,0,"]));
    expect((await leerCostoSku(e.empresaId, "C-1"))?.costo).toBe("500.00");
    expect((await leerCostoSku(e.empresaId, "C-2"))?.costo).toBe("0.00");
    expect((await leerCostoSku(e.empresaId, "C-2"))?.envioAgencia).toBe("100.00");

    // .xlsx: celda vacía (null) vs número 0.
    const vistaXlsx = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, {
      nombre: "c.xlsx",
      contenido: crearXlsxDePrueba([["SKU", "Costo producto"], ["C-1", 0], ["C-3", null]]),
    });
    expect(vistaXlsx.filas.find((f) => f.sku === "C-1")?.cambios).toEqual([{ campo: "costo", anterior: "500.00", nuevo: "0" }]);
    expect(vistaXlsx.filas.find((f) => f.sku === "C-3")).toMatchObject({ estado: "nueva" });
    expect(vistaXlsx.filas.find((f) => f.sku === "C-3")?.avisos.join(" ")).toContain("Sin costo");

    const auditados = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidad, "costo_sku")));
    const cambioC2 = auditados.find((a) => a.accion === "modificar" && a.detalle?.includes("C-2"));
    expect(cambioC2?.valorAnterior).toBe("costo=600.00");
    expect(cambioC2?.valorNuevo).toBe("costo=0");
    expect(auditados.some((a) => a.accion === "importar_maestra_sku")).toBe(true);
  });

  it("los tres precios mínimos van a su columna por alias y por selección manual", async () => {
    const e = await empresaConProveedores();
    // Encabezados que no se reconocen: se eligen a mano.
    const archivo = csv(["codigo interno,piso A,piso B,piso C", "M-1,10,20,30"]);
    const sinMapeo = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo);
    expect(sinMapeo.errores[0].mensaje).toContain("No se encontró la columna SKU");

    const mapeo = { sku: 0, precio_minimo_unidad: 3, precio_minimo_combo_x2: 1, precio_minimo_combo_x3: 2 };
    await confirmarImportacionMaestra(e.empresaId, e.usuarioId, archivo, mapeo);
    expect(await leerCostoSku(e.empresaId, "M-1")).toMatchObject({ precioMinimoUnidad: "30.00", precioMinimoComboX2: "10.00", precioMinimoComboX3: "20.00" });

    await expect(previsualizarImportacionMaestra(e.empresaId, e.usuarioId, archivo, { sku: 0, costo: 0 })).rejects.toBeInstanceOf(ArchivoMaestraInvalidoError);

    const porAlias = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, csv(["SKU,Precio mínimo venta 3,Precio mínimo venta 1,Precio mínimo venta 2", "M-2,3,1,2"]));
    expect(porAlias.filas[0].valores).toMatchObject({ precioMinimoUnidad: "1", precioMinimoComboX2: "2", precioMinimoComboX3: "3" });
  });

  it("packing igual al del proveedor no crea valor propio; al cambiar el del proveedor cambia el efectivo de quien no tiene propio", async () => {
    const e = await empresaConProveedores();
    await confirmarImportacionMaestra(e.empresaId, e.usuarioId, csv(["sku,proveedor,costo,packing", "P-IGUAL,Infinity,1,3.000", "P-PROPIO,Infinity,1,1.500"]));
    expect((await leerCostoSku(e.empresaId, "P-IGUAL"))?.empaque).toBeNull();
    expect((await leerCostoSku(e.empresaId, "P-PROPIO"))?.empaque).toBe("1500.00");

    await actualizarTercero({ empresaId: e.empresaId, usuarioId: e.usuarioId, terceroId: e.infinity, cambios: { empaque: "3500" } });
    expect((await costosParaUtilidad(e.empresaId, "P-IGUAL")).packing).toMatchObject({ valor: "3500.00", origen: "proveedor" });
    expect((await costosParaUtilidad(e.empresaId, "P-PROPIO")).packing).toMatchObject({ valor: "1500.00", origen: "sku" });

    const rastro = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, e.infinity)));
    expect(rastro.some((a) => a.valorAnterior?.includes("empaque=3000.00") && a.valorNuevo?.includes("empaque=3500"))).toBe(true);
  });

  it("un archivo con el SKU de otra empresa no la afecta (A/B)", async () => {
    const a = await empresaConProveedores();
    const b = await empresaConProveedores();
    await confirmarImportacionMaestra(b.empresaId, b.usuarioId, csv(["sku,costo", "COMPARTIDO,999"]));
    await confirmarImportacionMaestra(a.empresaId, a.usuarioId, csv(["sku,costo", "COMPARTIDO,1"]));
    expect((await leerCostoSku(b.empresaId, "COMPARTIDO"))?.costo).toBe("999.00");
    expect((await leerCostoSku(a.empresaId, "COMPARTIDO"))?.costo).toBe("1.00");

    // El proveedor de B no existe para A.
    const vista = await previsualizarImportacionMaestra(a.empresaId, a.usuarioId, csv(["sku,proveedor", "X,Infinity"]));
    expect(vista.errores).toEqual([]);
    expect(vista.filas[0].valores.terceroId).toBe(a.infinity);
  });

  it("sin finanzas.modificar, vista previa y confirmación fallan", async () => {
    const soloLectura = await crearEmpresaConPermisos("Solo consulta", [{ modulo: "finanzas", accion: "consultar" }]);
    const archivo = csv(["sku,costo", "X,1"]);
    await expect(previsualizarImportacionMaestra(soloLectura.empresaId, soloLectura.usuarioId, archivo)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(confirmarImportacionMaestra(soloLectura.empresaId, soloLectura.usuarioId, archivo)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("los topes de tamaño y filas se validan en el servidor", async () => {
    const e = await empresaConProveedores();
    const muchas = ["sku,costo", ...Array.from({ length: FILAS_MAXIMAS_MAESTRA + 1 }, (_, i) => `T-${i},1`)];
    const vista = await previsualizarImportacionMaestra(e.empresaId, e.usuarioId, csv(muchas));
    expect(vista.errores[0].mensaje).toContain(`${FILAS_MAXIMAS_MAESTRA}`);
    expect(puedeConfirmar(vista)).toBe(false);

    const enorme = { nombre: "grande.csv", contenido: Buffer.alloc(5 * 1024 * 1024 + 1, "a") };
    await expect(previsualizarImportacionMaestra(e.empresaId, e.usuarioId, enorme)).rejects.toBeInstanceOf(ArchivoMaestraInvalidoError);
  });
});

// Pura (calcularVistaPrevia no lee la base): proveedor nuevo, repetido,
// desactivado y duplicado.
describe("vista previa: proveedores que no existen (Refs #128)", () => {
  const texto = (valor: string) => ({ tipo: "texto" as const, valor });
  const hoja = (filas: [string, string][]): FilaArchivo[] => [
    { numeroFila: 1, celdas: [texto("SKU"), texto("Proveedor"), texto("Costo")] },
    ...filas.map(([sku, proveedor], i) => ({ numeroFila: i + 2, celdas: [texto(sku), texto(proveedor), { tipo: "numero" as const, valor: "100" }] })),
  ];
  const contexto = (proveedores: { id: string; nombre: string; activo: boolean }[]) => ({
    existentes: new Map(),
    proveedores: proveedores.map((p) => ({ ...p, empaque: null })),
    nombresCatalogo: new Map<string, string>(),
  });

  it("un nombre nuevo no es error: aviso, proveedorACrear y proveedoresNuevos", () => {
    const vista = calcularVistaPrevia(hoja([["A-1", "  Nuevo   Prov "]]), contexto([]));
    expect(vista.errores).toEqual([]);
    expect(vista.filas[0]).toMatchObject({ estado: "nueva", proveedorACrear: "Nuevo Prov", proveedorNombre: "Nuevo Prov" });
    expect(vista.filas[0].valores.terceroId).toBeNull();
    expect(vista.filas[0].avisos).toContain("Se creará el proveedor «Nuevo Prov».");
    expect(vista.filas[0].cambios).toContainEqual({ campo: "proveedor", anterior: null, nuevo: "Nuevo Prov" });
    expect(vista.resumen.proveedoresNuevos).toBe(1);
    expect(puedeConfirmar(vista)).toBe(true);
  });

  it("dos filas con el mismo nombre (mayúsculas y espacios aparte) crean un solo proveedor", () => {
    const vista = calcularVistaPrevia(hoja([["A-1", "Nuevo Prov"], ["A-2", "nuevo  PROV"]]), contexto([]));
    expect(vista.resumen.proveedoresNuevos).toBe(1);
    expect(vista.filas.map((f) => f.proveedorACrear)).toEqual(["Nuevo Prov", "Nuevo Prov"]);
  });

  it("sigue siendo error: un proveedor desactivado, o dos con el mismo nombre", () => {
    const inactivo = calcularVistaPrevia(hoja([["A-1", "Viejo"]]), contexto([{ id: "t1", nombre: "Viejo", activo: false }]));
    expect(inactivo.errores[0].mensaje).toContain("desactivado");
    expect(inactivo.resumen.proveedoresNuevos).toBe(0);

    const duplicado = calcularVistaPrevia(
      hoja([["A-1", "Doble"]]),
      contexto([
        { id: "t1", nombre: "Doble", activo: true },
        { id: "t2", nombre: "doble", activo: true },
      ])
    );
    expect(duplicado.errores[0].mensaje).toContain("más de un proveedor");
  });

  it("un SKU guardado que pasa a un proveedor nuevo cuenta como cambio", () => {
    const ctx = contexto([{ id: "t1", nombre: "Viejo", activo: true }]);
    ctx.existentes.set("A-1", {
      id: "c1",
      skuCodigo: "A-1",
      nombreProducto: null,
      terceroId: "t1",
      costo: "100.00",
      empaque: null,
      envioAgencia: null,
      precioMinimoUnidad: null,
      precioMinimoComboX2: null,
      precioMinimoComboX3: null,
      precioVenta: null,
    });
    const vista = calcularVistaPrevia(hoja([["A-1", "Otro"]]), ctx);
    expect(vista.filas[0]).toMatchObject({ estado: "cambio", cambios: [{ campo: "proveedor", anterior: "Viejo", nuevo: "Otro" }] });
  });
});
