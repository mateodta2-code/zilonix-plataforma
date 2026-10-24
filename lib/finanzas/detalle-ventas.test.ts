import { describe, expect, it } from "vitest";
import {
  armarDetalleVentas,
  type AgruparPor,
  type DiaDetalle,
  type TotalesDetalle,
  type VentaDetalleEntrada,
} from "./detalle-ventas";
import { EntradaUtilidadInvalidaError, aCentavos, calcularUtilidadVenta, desdeCentavos, type FormaEntrega } from "./utilidad-venta";

// Datos inventados: ningún pedido, cuenta ni monto sale de una empresa real.
interface LineaPrueba {
  linea: number;
  valor: string;
  costo: string | null;
  cantidad?: number;
  titulo?: string;
  sku?: string | null;
}

interface VentaPrueba {
  pedido: string;
  cuenta: string;
  nickname: string;
  creada: string;
  pago?: string;
  despacho?: string | null;
  estado?: string;
  cancelada?: boolean;
  forma?: FormaEntrega;
  valor: string;
  comision: string;
  flete: string;
  empaque: string;
  envio: string;
  lineas: LineaPrueba[];
}

function ventaDetalle(v: VentaPrueba): VentaDetalleEntrada {
  const resultado = calcularUtilidadVenta({
    pedido_id: v.pedido,
    cuenta_ml_id: v.cuenta,
    forma_entrega: v.forma ?? "agencia",
    fecha_pago_aprobado: new Date(v.pago ?? v.creada),
    valor_venta: v.valor,
    comision_ml: v.comision,
    flete_ml: v.flete,
    empaque_congelado: v.empaque,
    envio_agencia_congelado: v.envio,
    lineas: v.lineas.map((l) => ({ linea: l.linea, cantidad: l.cantidad ?? 1, valor_linea: l.valor, costo_congelado: l.costo })),
    correcciones: [],
  });
  return {
    resultado,
    estado: v.estado ?? "paid",
    cancelada: v.cancelada ?? false,
    fecha_creacion: new Date(v.creada),
    fecha_despacho: v.despacho ? new Date(v.despacho) : null,
    fecha_entrega: null,
    cuenta_nickname: v.nickname,
    lineas: v.lineas.map((l) => ({ linea: l.linea, titulo: l.titulo ?? `Producto ${v.pedido}-${l.linea}`, sku_codigo: l.sku ?? null })),
  };
}

// Caso de la captura de Sharel: el 24 de octubre, una venta de Mateo
// (Agencia, una línea) y una de Rafa (Flex, dos productos).
const ventaMateo = (parcial: Partial<VentaPrueba> = {}) =>
  ventaDetalle({
    pedido: "pedido-m1",
    cuenta: "cuenta-mateo",
    nickname: "Mateo",
    creada: "2026-10-24T15:00:00Z",
    valor: "100000.00",
    comision: "13000.00",
    flete: "8000.00",
    empaque: "1500.00",
    envio: "2000.00",
    lineas: [{ linea: 1, valor: "100000.00", costo: "40000.00", cantidad: 2, titulo: "Reloj", sku: "REL-01" }],
    ...parcial,
  });

const ventaRafa = (parcial: Partial<VentaPrueba> = {}) =>
  ventaDetalle({
    pedido: "pedido-r1",
    cuenta: "cuenta-rafa",
    nickname: "Rafa",
    creada: "2026-10-24T18:30:00Z",
    forma: "flex",
    valor: "80000.00",
    comision: "9600.00",
    flete: "0.00",
    empaque: "1000.00",
    envio: "7000.00",
    lineas: [
      { linea: 1, valor: "50000.00", costo: "20000.00", titulo: "Audífonos", sku: "AUD-02" },
      { linea: 2, valor: "30000.00", costo: "15000.00", cantidad: 3, titulo: "Cable", sku: null },
    ],
    ...parcial,
  });

const COLUMNAS_DINERO = [
  "recaudo",
  "recaudo_sin_costo",
  "comision_ml",
  "flete_ml",
  "costo_producto",
  "empaque",
  "envio",
  "utilidad",
] as const;
const COLUMNAS_NUMERO = ["ventas", "ventas_sin_costo", "cantidad"] as const;

type FilaConColumnas = Omit<TotalesDetalle, "costo_producto" | "utilidad"> & {
  costo_producto: string | null;
  utilidad: string | null;
};

// Suma una columna de dinero en centavos (null = no entra, como en el detalle).
function sumarColumna(filas: FilaConColumnas[], columna: (typeof COLUMNAS_DINERO)[number]): string {
  return desdeCentavos(filas.reduce((a, fila) => a + (fila[columna] === null ? BigInt(0) : aCentavos(fila[columna] as string)), BigInt(0)));
}

// Día = suma de sus cuentas = suma de sus productos, en todas las columnas.
function verificarSumas(dia: DiaDetalle): void {
  const cuentas = dia.cuentas.map((c) => c.totales);
  const productos = dia.cuentas.flatMap((c) => c.productos);
  for (const columna of COLUMNAS_DINERO) {
    expect(sumarColumna(cuentas, columna)).toBe(dia.totales[columna]);
    expect(sumarColumna(productos, columna)).toBe(dia.totales[columna]);
    for (const cuenta of dia.cuentas) {
      expect(sumarColumna(cuenta.productos, columna)).toBe(cuenta.totales[columna]);
    }
  }
  for (const columna of COLUMNAS_NUMERO) {
    expect(cuentas.reduce((a, c) => a + c[columna], 0)).toBe(dia.totales[columna]);
    expect(productos.reduce((a, p) => a + p[columna], 0)).toBe(dia.totales[columna]);
  }
  expect(dia.numero_ventas).toBe(dia.totales.ventas);
  expect(dia.numero_cuentas).toBe(dia.cuentas.length);
}

describe("armarDetalleVentas", () => {
  it("caso de la captura: un día con 2 cuentas y 2 ventas; cada cuenta 1 venta; día = cuentas = productos", () => {
    const detalle = armarDetalleVentas([ventaMateo(), ventaRafa()]);
    expect(detalle.agrupar_por).toBe("creacion");
    expect(detalle.dias).toHaveLength(1);
    const [dia] = detalle.dias;
    expect(dia.dia).toBe("2026-10-24");
    expect([dia.numero_cuentas, dia.numero_ventas]).toEqual([2, 2]);
    expect(dia.cuentas.map((c) => [c.nickname, c.numero_ventas])).toEqual([
      ["Mateo", 1],
      ["Rafa", 1],
    ]);
    verificarSumas(dia);

    expect(dia.totales).toEqual({
      ventas: 2,
      ventas_sin_costo: 0,
      recaudo: "180000.00",
      recaudo_sin_costo: "0.00",
      comision_ml: "22600.00",
      flete_ml: "8000.00",
      costo_producto: "75000.00",
      empaque: "2500.00",
      envio: "9000.00",
      // 35500.00 (Mateo) + 27400.00 (Rafa).
      utilidad: "62900.00",
      porcentaje_utilidad: "34.94",
      porcentaje_ml: "12.56",
      cantidad: 6,
    });
    expect(detalle.total).toEqual(dia.totales);
    expect(detalle.excluidas).toBe(0);

    const productos = dia.cuentas[1].productos;
    expect(productos.map((p) => [p.pedido_id, p.linea, p.titulo, p.sku_codigo, p.forma_entrega, p.cantidad])).toEqual([
      ["pedido-r1", 1, "Audífonos", "AUD-02", "flex", 1],
      ["pedido-r1", 2, "Cable", null, "flex", 3],
    ]);
    // La venta se cuenta una vez, en su primera línea.
    expect(productos.map((p) => p.ventas)).toEqual([1, 0]);
  });

  it("Recaudo = valor de la venta, sin restar nada; % ML = comisión ÷ recaudo, sin flete", () => {
    const detalle = armarDetalleVentas([ventaMateo()]);
    const cuenta = detalle.dias[0].cuentas[0];
    expect(cuenta.totales.recaudo).toBe("100000.00");
    expect(cuenta.productos[0].recaudo).toBe("100000.00");
    // Con el flete (8000) daría 21.00.
    expect(cuenta.totales.porcentaje_ml).toBe("13.00");
    expect(cuenta.productos[0].porcentaje_ml).toBe("13.00");
    expect(cuenta.totales.porcentaje_utilidad).toBe("35.50");
    expect(cuenta.productos[0].utilidad).toBe("35500.00");
  });

  it("cancelled, invalid y cancelada = true no suman en ningún total, aunque tengan montos enormes", () => {
    const enorme = {
      valor: "999999999.99",
      comision: "1.00",
      flete: "1.00",
      lineas: [{ linea: 1, valor: "999999999.99", costo: "1.00" }],
    };
    const detalle = armarDetalleVentas([
      ventaMateo(),
      ventaRafa(),
      ventaMateo({ pedido: "pedido-cancelled", estado: "cancelled", ...enorme }),
      ventaRafa({ pedido: "pedido-invalid", estado: "invalid", ...enorme }),
      ventaMateo({ pedido: "pedido-reembolsado", cancelada: true, ...enorme }),
    ]);
    const limpio = armarDetalleVentas([ventaMateo(), ventaRafa()]);
    expect(detalle.dias).toEqual(limpio.dias);
    expect(detalle.total).toEqual(limpio.total);
    expect(detalle.excluidas).toBe(3);
    expect(detalle.dias[0].cuentas.flatMap((c) => c.productos.map((p) => p.pedido_id))).not.toContain("pedido-cancelled");
  });

  it("borde de Bogotá por fecha de creación: 23:59 en ese día, 00:00 en el siguiente; pagada al otro día cuenta el de creación", () => {
    const detalle = armarDetalleVentas([
      // 23:59 del 23 en Bogotá, pago aprobado el 24.
      ventaMateo({ pedido: "creada-23", creada: "2026-10-24T04:59:00Z", pago: "2026-10-24T15:00:00Z" }),
      // 00:00 del 24 en Bogotá.
      ventaRafa({ pedido: "creada-24", creada: "2026-10-24T05:00:00Z" }),
    ]);
    expect(detalle.dias.map((d) => [d.dia, d.cuentas.flatMap((c) => c.productos.map((p) => p.pedido_id))])).toEqual([
      ["2026-10-24", ["creada-24", "creada-24"]],
      ["2026-10-23", ["creada-23"]],
    ]);
    // El día de pago aprobado del motor queda como dato, pero no agrupa.
    const venta23 = ventaMateo({ pedido: "creada-23", creada: "2026-10-24T04:59:00Z", pago: "2026-10-24T15:00:00Z" });
    expect(venta23.resultado.dia_bogota).toBe("2026-10-24");
  });

  it('agruparPor "despacho": agrupa por día de despacho y las ventas sin despacho quedan en sin_fecha_despacho', () => {
    const ventas = [
      ventaMateo({ pedido: "desp-25", despacho: "2026-10-25T13:00:00Z" }),
      ventaRafa({ pedido: "desp-26", despacho: "2026-10-27T04:00:00Z" }),
      ventaMateo({ pedido: "sin-despacho-b", despacho: null }),
      ventaRafa({ pedido: "sin-despacho-a", despacho: null }),
      ventaMateo({ pedido: "cancelada-sin-despacho", estado: "cancelled", despacho: null }),
    ];
    const detalle = armarDetalleVentas(ventas, { agruparPor: "despacho" });
    expect(detalle.agrupar_por).toBe("despacho");
    // 2026-10-27T04:00Z = 23:00 del 26 en Bogotá.
    expect(detalle.dias.map((d) => d.dia)).toEqual(["2026-10-26", "2026-10-25"]);
    expect(detalle.sin_fecha_despacho).toEqual({ ventas: 2, pedido_ids: ["sin-despacho-a", "sin-despacho-b"] });
    expect(detalle.excluidas).toBe(1);
    expect(detalle.total.ventas).toBe(2);
    expect(detalle.total.recaudo).toBe("180000.00");
    detalle.dias.forEach(verificarSumas);

    // Por defecto (creación) las cuatro ventas válidas caen el 24 y no hay
    // ninguna "sin fecha de despacho".
    const porCreacion = armarDetalleVentas(ventas);
    expect(porCreacion.dias.map((d) => [d.dia, d.numero_ventas])).toEqual([["2026-10-24", 4]]);
    expect(porCreacion.sin_fecha_despacho).toEqual({ ventas: 0, pedido_ids: [] });
  });

  it("venta sin costo: suma en recaudo y % ML, no en costo ni utilidad, y se cuenta aparte", () => {
    const sinCosto = ventaRafa({
      pedido: "sin-costo",
      cuenta: "cuenta-mateo",
      nickname: "Mateo",
      valor: "50000.00",
      comision: "6000.00",
      flete: "0.00",
      lineas: [{ linea: 1, valor: "50000.00", costo: null }],
    });
    const detalle = armarDetalleVentas([ventaMateo(), sinCosto]);
    const cuenta = detalle.dias[0].cuentas[0];
    expect(cuenta.numero_ventas).toBe(2);
    expect(cuenta.totales).toEqual({
      ventas: 2,
      ventas_sin_costo: 1,
      recaudo: "150000.00",
      recaudo_sin_costo: "50000.00",
      comision_ml: "19000.00",
      flete_ml: "8000.00",
      costo_producto: "40000.00",
      empaque: "2500.00",
      envio: "9000.00",
      utilidad: "35500.00",
      // 35500 ÷ 100000 (solo el recaudo con costo).
      porcentaje_utilidad: "35.50",
      // 19000 ÷ 150000 (todo el recaudo).
      porcentaje_ml: "12.67",
      cantidad: 3,
    });
    const fila = cuenta.productos.find((p) => p.pedido_id === "sin-costo");
    expect(fila?.costo_producto).toBeNull();
    expect(fila?.utilidad).toBeNull();
    expect(fila?.porcentaje_utilidad).toBeNull();
    expect(fila?.porcentaje_ml).toBe("12.00");
    verificarSumas(detalle.dias[0]);
  });

  it("orden estable: la misma entrada en otro orden da la misma salida", () => {
    const ventas = [
      ventaMateo(),
      ventaRafa(),
      ventaMateo({ pedido: "pedido-m0", creada: "2026-10-24T15:00:00Z" }),
      ventaRafa({ pedido: "pedido-r-otro-dia", creada: "2026-10-20T12:00:00Z" }),
      // Mismo nickname, otra cuenta: desempata por cuenta_ml_id.
      ventaMateo({ pedido: "pedido-m-bis", cuenta: "cuenta-mateo-2", creada: "2026-10-24T13:00:00Z" }),
    ];
    const base = armarDetalleVentas(ventas);
    expect(armarDetalleVentas([...ventas].reverse())).toEqual(base);
    expect(armarDetalleVentas([ventas[2], ventas[4], ventas[0], ventas[3], ventas[1]])).toEqual(base);

    expect(base.dias.map((d) => d.dia)).toEqual(["2026-10-24", "2026-10-20"]);
    expect(base.dias[0].cuentas.map((c) => [c.nickname, c.cuenta_ml_id])).toEqual([
      ["Mateo", "cuenta-mateo"],
      ["Mateo", "cuenta-mateo-2"],
      ["Rafa", "cuenta-rafa"],
    ]);
    // Misma fecha de creación: desempata por pedido_id.
    expect(base.dias[0].cuentas[0].productos.map((p) => p.pedido_id)).toEqual(["pedido-m0", "pedido-m1"]);
  });

  it("16 cuentas con montos cerca del tope de numeric(14,2) no pierden centavos", () => {
    const ventas = Array.from({ length: 16 }, (_, i) =>
      ventaMateo({
        pedido: `grande-${String(i).padStart(2, "0")}`,
        cuenta: `cuenta-${String(i).padStart(2, "0")}`,
        nickname: `Cuenta ${String(i).padStart(2, "0")}`,
        valor: "999999999999.99",
        comision: "99999999999.99",
        flete: "0.00",
        empaque: "0.00",
        envio: "0.00",
        lineas: [{ linea: 1, valor: "999999999999.99", costo: "0.01" }],
      }),
    );
    const detalle = armarDetalleVentas(ventas);
    const [dia] = detalle.dias;
    expect([dia.numero_cuentas, dia.numero_ventas]).toEqual([16, 16]);
    expect(dia.totales.recaudo).toBe("15999999999999.84");
    expect(dia.totales.comision_ml).toBe("1599999999999.84");
    expect(dia.totales.costo_producto).toBe("0.16");
    // Cada una: 999999999999.99 − 99999999999.99 − 0.01 = 899999999999.99.
    expect(dia.totales.utilidad).toBe("14399999999999.84");
    expect(dia.totales.porcentaje_ml).toBe("10.00");
    verificarSumas(dia);
  });

  it("entrada inválida: EntradaUtilidadInvalidaError", () => {
    const base = ventaMateo();
    expect(() => armarDetalleVentas([{ ...base, lineas: [...base.lineas, { linea: 9, titulo: "No existe", sku_codigo: null }] }])).toThrow(
      EntradaUtilidadInvalidaError,
    );
    expect(() => armarDetalleVentas([{ ...base, lineas: [] }])).toThrow(EntradaUtilidadInvalidaError);
    expect(() => armarDetalleVentas([{ ...base, fecha_creacion: new Date("no es fecha") }])).toThrow(EntradaUtilidadInvalidaError);
    expect(() => armarDetalleVentas([{ ...base, fecha_despacho: new Date("tampoco") }])).toThrow(EntradaUtilidadInvalidaError);
    expect(() => armarDetalleVentas([base], { agruparPor: "pago" as AgruparPor })).toThrow(EntradaUtilidadInvalidaError);
    expect(() => armarDetalleVentas([base, ventaMateo()])).toThrow(EntradaUtilidadInvalidaError);
    expect(() => armarDetalleVentas([base, ventaMateo({ pedido: "otro", nickname: "Otro nombre" })])).toThrow(
      EntradaUtilidadInvalidaError,
    );
  });

  it("sin ventas: ningún día y totales en cero", () => {
    const detalle = armarDetalleVentas([]);
    expect(detalle.dias).toEqual([]);
    expect(detalle.total.recaudo).toBe("0.00");
    expect(detalle.total.porcentaje_ml).toBeNull();
    expect(detalle.total.porcentaje_utilidad).toBeNull();
  });
});
