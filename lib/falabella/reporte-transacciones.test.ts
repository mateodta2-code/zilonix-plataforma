import { describe, expect, it } from "vitest";
import { CORTE_PRUEBA, crearReporteDePrueba, ENCABEZADO_REPORTE, filasReporteCorte, SELLER_ID_PRUEBA } from "@/lib/test-utils/reporte-falabella";
import {
  clasificarCategoria,
  leerFechaReporte,
  leerMontoReporte,
  leerReporteTransacciones,
  sumarMontos,
  type LineaReporte,
} from "./reporte-transacciones";

function leerOk(contenido: Buffer) {
  const reporte = leerReporteTransacciones(contenido);
  if (!reporte.ok) throw new Error(reporte.mensaje);
  return reporte;
}

function sumaDe(lineas: LineaReporte[], categoria?: string) {
  return sumarMontos(lineas.filter((l) => !categoria || l.categoria === categoria).map((l) => l.monto));
}

describe("leerReporteTransacciones — corte del 11 de noviembre (anonimizado)", () => {
  const reporte = leerOk(crearReporteDePrueba());

  it("lee las 28 líneas de 8 órdenes y suma el «Pago a recibir»", () => {
    expect(reporte.noReconocidas).toEqual([]);
    expect(reporte.lineas).toHaveLength(28);
    expect(new Set(reporte.lineas.map((l) => l.numeroOrden)).size).toBe(8);
    expect(sumaDe(reporte.lineas)).toBe("117830.94");
    expect(reporte.sellerIds).toEqual([SELLER_ID_PRUEBA]);
  });

  it("separa precio, comisiones, envíos y retenciones como en el corte real", () => {
    expect(sumaDe(reporte.lineas, "precio")).toBe("185800");
    expect(sumaDe(reporte.lineas, "comision")).toBe("-28869");
    expect(sumaDe(reporte.lineas, "envio")).toBe("-12300");
    expect(sumaDe(reporte.lineas, "retencion")).toBe("-26800.06");
  });

  it("guarda los datos del corte y deja vacíos el monto sin IVA y el IVA que no vienen", () => {
    const retencion = reporte.lineas.find((l) => l.tipoTransaccion === "Retención ICA")!;
    expect(retencion).toMatchObject({ estadoCuenta: CORTE_PRUEBA, estadoPago: "Pagado", moneda: "COP", montoSinIva: null, iva: null });
    const envio = reporte.lineas.find((l) => l.tipoTransaccion === "Cobro de envío")!;
    expect(envio).toMatchObject({ montoSinIva: "-6638.66", iva: "-1261.34", monto: "-7900", documentoTributario: "FE-0001" });
    // Texto «06/11/2026» y fecha de Excel 46332 son el mismo día.
    expect(new Set(reporte.lineas.map((l) => l.fechaTransaccion))).toEqual(new Set(["2026-11-06"]));
  });

  it("mapea las columnas por nombre, no por posición", () => {
    const orden = [...ENCABEZADO_REPORTE.keys()].reverse();
    const filas = filasReporteCorte().map((f) => orden.map((i) => f[i]));
    const invertido = leerOk(crearReporteDePrueba(filas, orden.map((i) => ENCABEZADO_REPORTE[i])));
    expect(sumaDe(invertido.lineas)).toBe("117830.94");
    expect(invertido.lineas.map((l) => l.huella)).toEqual(reporte.lineas.map((l) => l.huella));
  });

  it("la huella es la misma al volver a leer el archivo y distinta para cada línea", () => {
    const otraVez = leerOk(crearReporteDePrueba());
    expect(otraVez.lineas.map((l) => l.huella)).toEqual(reporte.lineas.map((l) => l.huella));
    expect(new Set(reporte.lineas.map((l) => l.huella)).size).toBe(28);
  });

  it("dos líneas idénticas en el mismo archivo no se pisan, y el estado de pago no cambia la huella", () => {
    const filas = filasReporteCorte();
    const duplicada = leerOk(crearReporteDePrueba([...filas, filas[0]]));
    expect(new Set(duplicada.lineas.map((l) => l.huella)).size).toBe(29);

    const columnaEstado = ENCABEZADO_REPORTE.indexOf("Estado de pago");
    const columnaCorte = ENCABEZADO_REPORTE.indexOf("Nº estado de cuenta");
    const pendientes = filas.map((f) => f.map((v, i) => (i === columnaEstado ? "Pendiente" : i === columnaCorte ? null : v)));
    const delPeriodo = leerOk(crearReporteDePrueba(pendientes));
    expect(delPeriodo.lineas.map((l) => l.huella)).toEqual(reporte.lineas.map((l) => l.huella));
  });
});

describe("leerReporteTransacciones — líneas y archivos que no sirven", () => {
  it("una línea con monto ilegible no entra y se informa con su fila", () => {
    const filas = filasReporteCorte();
    const columnaMonto = ENCABEZADO_REPORTE.indexOf("Monto con IVA");
    filas[3][columnaMonto] = "28.869,00";
    const reporte = leerOk(crearReporteDePrueba(filas));
    expect(reporte.lineas).toHaveLength(27);
    // Filas 1 a 6 son título y encabezado: la cuarta línea es la fila 10.
    expect(reporte.noReconocidas).toEqual([{ numeroFila: 10, motivo: "monto con IVA vacío o con formato no reconocido" }]);
  });

  it("acepta publicidad sin Nº de orden", () => {
    const filas = filasReporteCorte();
    const publicidad = [...filas[0]];
    publicidad[ENCABEZADO_REPORTE.indexOf("Nº de orden")] = null;
    publicidad[ENCABEZADO_REPORTE.indexOf("Tipo de transacción")] = "Cobro Productos patrocinados";
    publicidad[ENCABEZADO_REPORTE.indexOf("Categoría de transacciones")] = "Publicidad";
    publicidad[ENCABEZADO_REPORTE.indexOf("Monto con IVA")] = -11900;
    const reporte = leerOk(crearReporteDePrueba([...filas, publicidad]));
    const linea = reporte.lineas.at(-1)!;
    expect(linea).toMatchObject({ numeroOrden: null, categoria: "publicidad", monto: "-11900" });
  });

  it("rechaza un archivo sin el encabezado del reporte", () => {
    const reporte = leerReporteTransacciones(crearReporteDePrueba([], ["SKU", "Precio"]));
    expect(reporte.ok).toBe(false);
  });
});

describe("clasificarCategoria", () => {
  it.each([
    ["Precio Producto", "Precio producto", "precio"],
    ["Comisiones", "Comisión", "comision"],
    ["Envíos", "Cobro de envío", "envio"],
    ["Envío FCOM", "Cobro de envío", "envio"],
    ["Envío Seller", "Envío a cargo del seller", "envio"],
    ["Cupones/Promociones", "Cupón seller", "promocion"],
    ["Impuesto", "Retención ICA", "retencion"],
    [null, "Retención en la Fuente", "retencion"],
    ["Publicidad", "Cobro publicidad", "publicidad"],
    [null, "Productos patrocinados", "publicidad"],
    ["Fulfillment", "Almacenamiento", "fulfillment"],
    [null, "Devolución precio producto", "devolucion"],
    [null, "Reembolso al cliente", "devolucion"],
    [null, "Compensación por pérdida", "ajuste"],
    [null, "Ajuste manual", "ajuste"],
    [null, "Algo nuevo de Falabella", "otro"],
  ] as const)("%s / %s → %s", (categoria, tipo, esperada) => {
    expect(clasificarCategoria(categoria, tipo)).toBe(esperada);
  });
});

describe("leerMontoReporte y leerFechaReporte", () => {
  it.each([
    [{ tipo: "numero", valor: "-28869" }, "-28869"],
    [{ tipo: "numero", valor: "0.123456" }, "0.1235"],
    [{ tipo: "texto", valor: "-1,234.56" }, "-1234.56"],
    [{ tipo: "texto", valor: "$ -28,869" }, "-28869"],
    [{ tipo: "texto", valor: "117830.94" }, "117830.94"],
  ] as const)("monto %j → %s", (celda, esperado) => {
    expect(leerMontoReporte(celda)).toEqual({ tipo: "monto", valor: esperado });
  });

  it("no adivina el punto de miles", () => {
    expect(leerMontoReporte({ tipo: "texto", valor: "78.000,00" })).toEqual({ tipo: "error" });
  });

  it.each([
    [{ tipo: "texto", valor: "11/11/2026" }, "2026-11-11"],
    [{ tipo: "texto", valor: "2026-11-11 10:20:00" }, "2026-11-11"],
    [{ tipo: "numero", valor: "46337.5" }, "2026-11-11"],
  ] as const)("fecha %j → %s", (celda, esperada) => {
    expect(leerFechaReporte(celda)).toEqual({ tipo: "fecha", valor: esperada });
  });

  it("rechaza una fecha imposible", () => {
    expect(leerFechaReporte({ tipo: "texto", valor: "31/02/2026" })).toEqual({ tipo: "error" });
  });
});
