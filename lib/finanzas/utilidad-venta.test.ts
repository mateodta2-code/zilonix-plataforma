import { describe, expect, it } from "vitest";
import {
  CAMPOS_CORREGIBLES,
  EntradaUtilidadInvalidaError,
  aCentavos,
  calcularUtilidadVenta,
  desdeCentavos,
  diaBogota,
  mesBogota,
  repartirProporcional,
  totalizarPorCuentaYMes,
  totalizarUtilidad,
  type CampoCorregible,
  type LineaVentaEntrada,
  type VentaEntrada,
} from "./utilidad-venta";

// Datos inventados: ningún pedido, cuenta ni monto sale de una empresa real.
function linea(parcial: Partial<LineaVentaEntrada> = {}): LineaVentaEntrada {
  return {
    linea: 1,
    cantidad: 1,
    valor_linea: "100000.00",
    costo_congelado: "40000.00",
    ...parcial,
  };
}

function venta(parcial: Partial<VentaEntrada> = {}): VentaEntrada {
  return {
    pedido_id: "pedido-prueba-1",
    cuenta_ml_id: "cuenta-a",
    forma_entrega: "agencia",
    fecha_pago_aprobado: new Date("2026-10-15T17:00:00Z"),
    valor_venta: "100000.00",
    comision_ml: "13000.00",
    flete_ml: "8000.00",
    empaque_congelado: "1500.00",
    envio_agencia_congelado: "2000.00",
    lineas: [linea()],
    correcciones: [],
    ...parcial,
  };
}

function correccion(campo: CampoCorregible, valor_nuevo: string, linea: number | null = null, anulada_ts: Date | null = null) {
  return { campo, valor_nuevo, linea, anulada_ts };
}

describe("dinero en centavos", () => {
  it("lee y escribe el formato de numeric(14,2) sin pasar por float", () => {
    expect(aCentavos("12345.67")).toBe(BigInt(1234567));
    expect(aCentavos("0.1")).toBe(BigInt(10));
    expect(aCentavos("7")).toBe(BigInt(700));
    expect(aCentavos("-0.05")).toBe(BigInt(-5));
    expect(desdeCentavos(BigInt(1234567))).toBe("12345.67");
    expect(desdeCentavos(BigInt(-5))).toBe("-0.05");
    expect(desdeCentavos(BigInt(0))).toBe("0.00");
  });

  it("rechaza montos que no son numeric(14,2)", () => {
    for (const malo of ["1.234", "1,00", "", "abc", "1e3", " 1.00", "+1.00"]) {
      expect(() => aCentavos(malo)).toThrow(EntradaUtilidadInvalidaError);
    }
  });
});

describe("repartirProporcional", () => {
  it("la suma de las partes da exactamente el total, aun con centavos que no dividen parejo", () => {
    const pesos = [BigInt(1), BigInt(1), BigInt(1)];
    const partes = repartirProporcional(BigInt(100), pesos);
    expect(partes).toEqual([BigInt(34), BigInt(33), BigInt(33)]);
    for (const total of [1, 2, 7, 99, 100, 1001, 999999]) {
      const otras = repartirProporcional(BigInt(total), [BigInt(3), BigInt(7), BigInt(11)]);
      expect(otras.reduce((a, b) => a + b, BigInt(0))).toBe(BigInt(total));
    }
  });

  it("los centavos sobrantes van a la línea con mayor residuo", () => {
    // 1 centavo entre pesos 1:2 → 0,33 y 0,66: la segunda tiene más residuo.
    expect(repartirProporcional(BigInt(1), [BigInt(1), BigInt(2)])).toEqual([BigInt(0), BigInt(1)]);
  });

  it("si todos los pesos son 0 reparte en partes iguales", () => {
    expect(repartirProporcional(BigInt(5), [BigInt(0), BigInt(0)])).toEqual([BigInt(3), BigInt(2)]);
  });

  it("reparte un total negativo sin perder centavos", () => {
    const partes = repartirProporcional(BigInt(-100), [BigInt(1), BigInt(1), BigInt(1)]);
    expect(partes.reduce((a, b) => a + b, BigInt(0))).toBe(BigInt(-100));
  });
});

describe("calcularUtilidadVenta", () => {
  it("venta completa: aplica la fórmula y el margen", () => {
    const r = calcularUtilidadVenta(venta());
    // 100.000 − 13.000 − 8.000 − 40.000 − 1.500 − 2.000
    expect(r.utilidad).toBe("35500.00");
    expect(r.margen_porcentaje).toBe("35.50");
    expect(r.con_costo).toBe(true);
    expect(r.comision_ml).toEqual({ valor: "13000.00", origen: "congelado" });
    expect(r.flete_ml).toEqual({ valor: "8000.00", origen: "congelado" });
    expect(r.costo_producto).toEqual({ valor: "40000.00", origen: "congelado" });
    expect(r.empaque).toEqual({ valor: "1500.00", origen: "congelado" });
    expect(r.envio).toEqual({ valor: "2000.00", origen: "congelado" });
    expect(r.avisos).toEqual([]);
  });

  it("venta sin costo: queda fuera del cálculo pero cuenta para el % de ventas con costo", () => {
    const sinCosto = calcularUtilidadVenta(venta({ pedido_id: "p-sin", lineas: [linea({ costo_congelado: null })] }));
    expect(sinCosto.con_costo).toBe(false);
    expect(sinCosto.utilidad).toBeNull();
    expect(sinCosto.margen_porcentaje).toBeNull();
    expect(sinCosto.costo_producto).toBeNull();
    expect(sinCosto.avisos).toContain("sin_costo");

    const conCosto = calcularUtilidadVenta(venta({ pedido_id: "p-con" }));
    const total = totalizarUtilidad([sinCosto, conCosto]);
    expect(total.ventas).toBe(2);
    expect(total.ventas_con_costo).toBe(1);
    expect(total.ventas_sin_costo).toBe(1);
    expect(total.porcentaje_ventas_con_costo).toBe("50.00");
    // La venta sin costo no suma utilidad ni conceptos: solo aparece aparte.
    expect(total.utilidad).toBe("35500.00");
    expect(total.valor_venta).toBe("100000.00");
    expect(total.valor_venta_sin_costo).toBe("100000.00");
  });

  it("si una sola línea no tiene costo, la orden entera queda fuera", () => {
    const r = calcularUtilidadVenta(
      venta({
        lineas: [
          linea({ linea: 1, valor_linea: "60000.00", costo_congelado: "20000.00" }),
          linea({ linea: 2, valor_linea: "40000.00", costo_congelado: null }),
        ],
      }),
    );
    expect(r.con_costo).toBe(false);
    expect(r.utilidad).toBeNull();
    expect(r.lineas[0].costo_producto).toEqual({ valor: "20000.00", origen: "congelado" });
    expect(r.lineas[1].costo_producto).toBeNull();
  });

  it("costo 0 puesto a propósito: cuenta como con costo y no genera alerta", () => {
    const r = calcularUtilidadVenta(venta({ lineas: [linea({ costo_congelado: "0.00" })] }));
    expect(r.con_costo).toBe(true);
    expect(r.costo_producto).toEqual({ valor: "0.00", origen: "congelado" });
    expect(r.utilidad).toBe("75500.00");
    expect(r.avisos).not.toContain("sin_costo");
    expect(totalizarUtilidad([r]).porcentaje_ventas_con_costo).toBe("100.00");
  });

  it("dos líneas: valor, comisión y flete se reparten por peso con reparto exacto; empaque y envío una sola vez", () => {
    const r = calcularUtilidadVenta(
      venta({
        valor_venta: "100.00",
        comision_ml: "0.10",
        flete_ml: "0.01",
        empaque_congelado: "1.50",
        envio_agencia_congelado: "2.00",
        lineas: [
          linea({ linea: 1, cantidad: 1, valor_linea: "10.00", costo_congelado: "5.00" }),
          linea({ linea: 2, cantidad: 2, valor_linea: "20.00", costo_congelado: "8.00" }),
        ],
      }),
    );
    // Pesos 1:2. 100,00 → 33,33 + 66,67; 0,10 → 0,03 + 0,07; 0,01 → 0,00 + 0,01.
    expect(r.lineas.map((l) => l.valor_venta)).toEqual(["33.33", "66.67"]);
    expect(r.lineas.map((l) => l.comision_ml.valor)).toEqual(["0.03", "0.07"]);
    expect(r.lineas.map((l) => l.flete_ml.valor)).toEqual(["0.00", "0.01"]);
    expect(r.comision_ml.valor).toBe("0.10");
    expect(r.flete_ml.valor).toBe("0.01");
    expect(r.costo_producto?.valor).toBe("13.00");
    // El empaque y el envío no se multiplican por la cantidad de líneas.
    expect(r.empaque.valor).toBe("1.50");
    expect(r.envio.valor).toBe("2.00");
    // 100 − 0,10 − 0,01 − 13 − 1,50 − 2
    expect(r.utilidad).toBe("83.39");
  });

  it("tres líneas iguales con un total que no divide parejo", () => {
    const r = calcularUtilidadVenta(
      venta({
        valor_venta: "100.00",
        comision_ml: "0.02",
        lineas: [1, 2, 3].map((n) => linea({ linea: n, valor_linea: "10.00", costo_congelado: "1.00" })),
      }),
    );
    expect(r.lineas.map((l) => l.valor_venta)).toEqual(["33.34", "33.33", "33.33"]);
    expect(r.lineas.map((l) => l.comision_ml.valor)).toEqual(["0.01", "0.01", "0.00"]);
  });

  it("Full de Mercado Libre: envío $0 aunque la maestra tenga envío agencia", () => {
    const r = calcularUtilidadVenta(venta({ forma_entrega: "full_ml", envio_agencia_congelado: "2000.00" }));
    expect(r.envio).toEqual({ valor: "0.00", origen: "full_ml" });
    expect(r.utilidad).toBe("37500.00");
  });

  it("Flex: usa el envío congelado", () => {
    const r = calcularUtilidadVenta(venta({ forma_entrega: "flex", envio_agencia_congelado: "7000.00" }));
    expect(r.envio).toEqual({ valor: "7000.00", origen: "congelado" });
    expect(r.utilidad).toBe("30500.00");
  });

  it("Agencia: un SKU FUL (Infinity) vendido por Agencia paga sus $2.000; la forma sale del dato, no del prefijo", () => {
    // El motor ni siquiera recibe el SKU: la única fuente es forma_entrega.
    const porAgencia = calcularUtilidadVenta(
      venta({ pedido_id: "p-ful-agencia", forma_entrega: "agencia", envio_agencia_congelado: "2000.00" }),
    );
    expect(porAgencia.envio).toEqual({ valor: "2000.00", origen: "congelado" });
    expect(porAgencia.utilidad).toBe("35500.00");

    const porFull = calcularUtilidadVenta(
      venta({ pedido_id: "p-ful-full", forma_entrega: "full_ml", envio_agencia_congelado: "2000.00" }),
    );
    expect(porFull.envio.valor).toBe("0.00");
  });

  it("forma desconocida: usa el envío congelado y avisa", () => {
    const r = calcularUtilidadVenta(venta({ forma_entrega: "desconocida" }));
    expect(r.envio.valor).toBe("2000.00");
    expect(r.avisos).toContain("forma_entrega_desconocida");
  });

  it("empaque o envío sin dato cuentan como $0 y avisan", () => {
    const r = calcularUtilidadVenta(venta({ empaque_congelado: null, envio_agencia_congelado: null }));
    expect(r.empaque.valor).toBe("0.00");
    expect(r.envio.valor).toBe("0.00");
    expect(r.avisos).toEqual(expect.arrayContaining(["empaque_sin_dato", "envio_sin_dato"]));
    expect(r.utilidad).toBe("39000.00");
  });

  describe("correcciones manuales", () => {
    it("la corrección activa gana; al anularla vuelve el congelado", () => {
      const corregida = calcularUtilidadVenta(
        venta({ correcciones: [correccion("costo_producto", "30000.00", 1)] }),
      );
      expect(corregida.costo_producto).toEqual({ valor: "30000.00", origen: "corregido" });
      expect(corregida.lineas[0].costo_producto).toEqual({ valor: "30000.00", origen: "corregido" });
      expect(corregida.utilidad).toBe("45500.00");

      const anulada = calcularUtilidadVenta(
        venta({ correcciones: [correccion("costo_producto", "30000.00", 1, new Date("2026-10-20T12:00:00Z"))] }),
      );
      expect(anulada.costo_producto).toEqual({ valor: "40000.00", origen: "congelado" });
      expect(anulada.utilidad).toBe("35500.00");
    });

    it("corrige cada campo de la lista cerrada y marca el origen por concepto", () => {
      const r = calcularUtilidadVenta(
        venta({
          correcciones: [
            correccion("comision_ml", "12000.00"),
            correccion("flete_ml", "7000.00"),
            correccion("empaque", "1000.00"),
            correccion("envio_agencia", "0.00"),
          ],
        }),
      );
      expect(r.comision_ml).toEqual({ valor: "12000.00", origen: "corregido" });
      expect(r.flete_ml).toEqual({ valor: "7000.00", origen: "corregido" });
      expect(r.empaque).toEqual({ valor: "1000.00", origen: "corregido" });
      expect(r.envio).toEqual({ valor: "0.00", origen: "corregido" });
      expect(r.costo_producto?.origen).toBe("congelado");
      expect(r.utilidad).toBe("40000.00");
    });

    it("una corrección de costo le da costo a una línea que no tenía", () => {
      const r = calcularUtilidadVenta(
        venta({
          lineas: [
            linea({ linea: 1, valor_linea: "50000.00", costo_congelado: "20000.00" }),
            linea({ linea: 2, valor_linea: "50000.00", costo_congelado: null }),
          ],
          correcciones: [correccion("costo_producto", "15000.00", 1), correccion("costo_producto", "18000.00", 2)],
        }),
      );
      expect(r.con_costo).toBe(true);
      expect(r.costo_producto).toEqual({ valor: "33000.00", origen: "corregido" });
    });

    it("una corrección de toda la orden se reparte por peso y gana sobre las de línea", () => {
      const r = calcularUtilidadVenta(
        venta({
          comision_ml: "9000.00",
          lineas: [
            linea({ linea: 1, valor_linea: "25000.00", costo_congelado: "10000.00" }),
            linea({ linea: 2, valor_linea: "75000.00", costo_congelado: "20000.00" }),
          ],
          correcciones: [correccion("comision_ml", "10000.00"), correccion("comision_ml", "1.00", 2)],
        }),
      );
      expect(r.comision_ml).toEqual({ valor: "10000.00", origen: "corregido" });
      expect(r.lineas.map((l) => l.comision_ml.valor)).toEqual(["2500.00", "7500.00"]);
      expect(r.avisos).toContain("correccion_linea_ignorada");
    });

    it("una corrección de línea solo cambia esa línea", () => {
      const r = calcularUtilidadVenta(
        venta({
          comision_ml: "10000.00",
          lineas: [
            linea({ linea: 1, valor_linea: "50000.00", costo_congelado: "10000.00" }),
            linea({ linea: 2, valor_linea: "50000.00", costo_congelado: "10000.00" }),
          ],
          correcciones: [correccion("comision_ml", "4000.00", 2)],
        }),
      );
      expect(r.lineas[0].comision_ml).toEqual({ valor: "5000.00", origen: "congelado" });
      expect(r.lineas[1].comision_ml).toEqual({ valor: "4000.00", origen: "corregido" });
      expect(r.comision_ml).toEqual({ valor: "9000.00", origen: "corregido" });
    });

    it("la corrección de envío gana también sobre la regla de Full", () => {
      const r = calcularUtilidadVenta(
        venta({ forma_entrega: "full_ml", correcciones: [correccion("envio_agencia", "500.00")] }),
      );
      expect(r.envio).toEqual({ valor: "500.00", origen: "corregido" });
    });

    it("rechaza campos fuera de la lista blanca, empaque/envío por línea y dos activas iguales", () => {
      expect(CAMPOS_CORREGIBLES).toEqual(["costo_producto", "empaque", "envio_agencia", "comision_ml", "flete_ml"]);
      const fuera = { ...correccion("costo_producto", "1.00"), campo: "valor_venta" as CampoCorregible };
      expect(() => calcularUtilidadVenta(venta({ correcciones: [fuera] }))).toThrow(EntradaUtilidadInvalidaError);
      expect(() => calcularUtilidadVenta(venta({ correcciones: [correccion("empaque", "1.00", 1)] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      expect(() =>
        calcularUtilidadVenta(
          venta({ correcciones: [correccion("flete_ml", "1.00"), correccion("flete_ml", "2.00")] }),
        ),
      ).toThrow(EntradaUtilidadInvalidaError);
      expect(() => calcularUtilidadVenta(venta({ correcciones: [correccion("flete_ml", "1.00", 9)] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      // Una anulada no choca con la activa nueva.
      expect(() =>
        calcularUtilidadVenta(
          venta({
            correcciones: [correccion("flete_ml", "1.00", null, new Date("2026-10-20T00:00:00Z")), correccion("flete_ml", "2.00")],
          }),
        ),
      ).not.toThrow();
    });
  });

  it("devolución parcial: valor_venta llega neto de reembolsos y el costo congelado se mantiene", () => {
    // Se vendieron 2 unidades por 100.000 y se reembolsó una (50.000).
    const r = calcularUtilidadVenta(
      venta({
        valor_venta: "50000.00",
        comision_ml: "6500.00",
        flete_ml: "8000.00",
        lineas: [linea({ cantidad: 2, valor_linea: "100000.00", costo_congelado: "40000.00" })],
      }),
    );
    // 50.000 − 6.500 − 8.000 − 40.000 − 1.500 − 2.000
    expect(r.utilidad).toBe("-8000.00");
    expect(r.margen_porcentaje).toBe("-16.00");
    expect(r.lineas[0].valor_venta).toBe("50000.00");
  });

  it("valor de venta 0 (reembolso total): utilidad negativa y sin margen", () => {
    const r = calcularUtilidadVenta(venta({ valor_venta: "0.00", comision_ml: "0.00" }));
    expect(r.utilidad).toBe("-51500.00");
    expect(r.margen_porcentaje).toBeNull();
  });

  describe("montos negativos", () => {
    it("rechaza costo, empaque y envío congelados negativos", () => {
      expect(() => calcularUtilidadVenta(venta({ lineas: [linea({ costo_congelado: "-1.00" })] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      expect(() => calcularUtilidadVenta(venta({ empaque_congelado: "-0.01" }))).toThrow(EntradaUtilidadInvalidaError);
      expect(() => calcularUtilidadVenta(venta({ envio_agencia_congelado: "-2000.00" }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      // En Full no se usa, pero un negativo sigue siendo un dato roto.
      expect(() =>
        calcularUtilidadVenta(venta({ forma_entrega: "full_ml", envio_agencia_congelado: "-2000.00" })),
      ).toThrow(EntradaUtilidadInvalidaError);
    });

    it("rechaza correcciones negativas de costo_producto, empaque y envio_agencia", () => {
      expect(() =>
        calcularUtilidadVenta(venta({ correcciones: [correccion("costo_producto", "-5.00", 1)] })),
      ).toThrow(EntradaUtilidadInvalidaError);
      expect(() => calcularUtilidadVenta(venta({ correcciones: [correccion("costo_producto", "-5.00")] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      expect(() => calcularUtilidadVenta(venta({ correcciones: [correccion("empaque", "-5.00")] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      expect(() => calcularUtilidadVenta(venta({ correcciones: [correccion("envio_agencia", "-5.00")] }))).toThrow(
        EntradaUtilidadInvalidaError,
      );
      // Una corrección negativa ya anulada no se usa y no rompe la venta.
      expect(() =>
        calcularUtilidadVenta(
          venta({ correcciones: [correccion("empaque", "-5.00", null, new Date("2026-10-20T00:00:00Z"))] }),
        ),
      ).not.toThrow();
    });

    it("comisión y flete sí pueden ser negativos, congelados o corregidos", () => {
      const congelados = calcularUtilidadVenta(venta({ comision_ml: "-500.00", flete_ml: "-100.00" }));
      // 100.000 + 500 + 100 − 40.000 − 1.500 − 2.000
      expect(congelados.utilidad).toBe("57100.00");
      const corregidos = calcularUtilidadVenta(
        venta({ correcciones: [correccion("comision_ml", "-500.00"), correccion("flete_ml", "-100.00", 1)] }),
      );
      expect(corregidos.comision_ml).toEqual({ valor: "-500.00", origen: "corregido" });
      expect(corregidos.flete_ml).toEqual({ valor: "-100.00", origen: "corregido" });
      expect(corregidos.utilidad).toBe("57100.00");
    });
  });

  it("rechaza ventas sin líneas, líneas repetidas o cantidades inválidas", () => {
    expect(() => calcularUtilidadVenta(venta({ lineas: [] }))).toThrow(EntradaUtilidadInvalidaError);
    expect(() => calcularUtilidadVenta(venta({ lineas: [linea(), linea()] }))).toThrow(EntradaUtilidadInvalidaError);
    expect(() => calcularUtilidadVenta(venta({ lineas: [linea({ cantidad: 0 })] }))).toThrow(EntradaUtilidadInvalidaError);
    expect(() => calcularUtilidadVenta(venta({ valor_venta: "10.001" }))).toThrow(EntradaUtilidadInvalidaError);
  });
});

describe("día de Bogotá", () => {
  it("23:59 de Bogotá sigue siendo ese día; 00:00 ya es el siguiente", () => {
    // 2026-10-30 23:59 Bogotá = 2026-10-31 04:59 UTC.
    expect(diaBogota(new Date("2026-10-31T04:59:00Z"))).toBe("2026-10-30");
    expect(diaBogota(new Date("2026-10-31T04:59:59.999Z"))).toBe("2026-10-30");
    expect(diaBogota(new Date("2026-10-31T05:00:00Z"))).toBe("2026-10-31");
  });

  it("el cambio de mes también es el de Bogotá", () => {
    expect(mesBogota(new Date("2026-11-01T04:59:00Z"))).toBe("2026-10");
    expect(mesBogota(new Date("2026-11-01T05:00:00Z"))).toBe("2026-11");
    expect(mesBogota(new Date("2027-01-01T04:59:00Z"))).toBe("2026-12");
  });

  it("la venta calculada trae el día y el mes de Bogotá de fecha_pago_aprobado", () => {
    const r = calcularUtilidadVenta(venta({ fecha_pago_aprobado: new Date("2026-11-01T04:59:00Z") }));
    expect(r.dia_bogota).toBe("2026-10-31");
    expect(r.mes_bogota).toBe("2026-10");
  });

  it("rechaza una fecha inválida", () => {
    expect(() => diaBogota(new Date("no es fecha"))).toThrow(EntradaUtilidadInvalidaError);
  });
});

describe("totales por cuenta y mes", () => {
  it("la suma de utilidades por venta coincide exactamente con los totales", () => {
    const ventas: VentaEntrada[] = [
      venta({ pedido_id: "a1", cuenta_ml_id: "cuenta-a", fecha_pago_aprobado: new Date("2026-09-30T23:00:00Z") }),
      venta({ pedido_id: "a2", cuenta_ml_id: "cuenta-a", fecha_pago_aprobado: new Date("2026-10-01T04:59:00Z"), valor_venta: "33333.33" }),
      venta({ pedido_id: "a3", cuenta_ml_id: "cuenta-a", fecha_pago_aprobado: new Date("2026-10-01T05:00:00Z"), forma_entrega: "full_ml" }),
      venta({ pedido_id: "a4", cuenta_ml_id: "cuenta-a", fecha_pago_aprobado: new Date("2026-10-10T12:00:00Z"), lineas: [linea({ costo_congelado: null })] }),
      venta({ pedido_id: "b1", cuenta_ml_id: "cuenta-b", fecha_pago_aprobado: new Date("2026-10-05T12:00:00Z") }),
      venta({
        pedido_id: "b2",
        cuenta_ml_id: "cuenta-b",
        fecha_pago_aprobado: new Date("2026-10-06T12:00:00Z"),
        valor_venta: "77777.77",
        comision_ml: "10101.01",
        lineas: [
          linea({ linea: 1, valor_linea: "11111.11", costo_congelado: "3333.33" }),
          linea({ linea: 2, valor_linea: "22222.22", costo_congelado: "4444.44" }),
          linea({ linea: 3, valor_linea: "33333.33", costo_congelado: "5555.55" }),
        ],
      }),
    ];
    const resultados = ventas.map(calcularUtilidadVenta);
    const grupos = totalizarPorCuentaYMes(resultados);

    expect(grupos.map((g) => [g.cuenta_ml_id, g.mes, g.ventas])).toEqual([
      ["cuenta-a", "2026-09", 2],
      ["cuenta-a", "2026-10", 2],
      ["cuenta-b", "2026-10", 2],
    ]);

    const sumaVentas = resultados.reduce((acc, r) => (r.utilidad === null ? acc : acc + aCentavos(r.utilidad)), BigInt(0));
    const sumaGrupos = grupos.reduce((acc, g) => acc + aCentavos(g.utilidad), BigInt(0));
    const total = totalizarUtilidad(resultados);
    expect(sumaGrupos).toBe(sumaVentas);
    expect(aCentavos(total.utilidad)).toBe(sumaVentas);

    // En cada grupo la fórmula se cumple también sobre los totales.
    for (const g of [...grupos, total]) {
      const recalculada =
        aCentavos(g.valor_venta) -
        aCentavos(g.comision_ml) -
        aCentavos(g.flete_ml) -
        aCentavos(g.costo_producto) -
        aCentavos(g.empaque) -
        aCentavos(g.envio);
      expect(recalculada).toBe(aCentavos(g.utilidad));
    }

    const aOctubre = grupos[1];
    expect(aOctubre.ventas_con_costo).toBe(1);
    expect(aOctubre.porcentaje_ventas_con_costo).toBe("50.00");
    const bOctubre = grupos[2];
    expect(bOctubre.ventas_con_costo).toBe(2);
    expect(total.porcentaje_ventas_con_costo).toBe("83.33");
  });

  it("cuenta las ventas con empaque sin dato, envío sin dato y forma desconocida", () => {
    const resultados = [
      venta({ pedido_id: "c1", empaque_congelado: null }),
      // Sin costo: igual cuenta, es un problema de la foto congelada.
      venta({ pedido_id: "c2", empaque_congelado: null, lineas: [linea({ costo_congelado: null })] }),
      venta({ pedido_id: "c3", envio_agencia_congelado: null }),
      // En Full el envío congelado no se usa: vacío no es "sin dato".
      venta({ pedido_id: "c4", forma_entrega: "full_ml", envio_agencia_congelado: null }),
      venta({ pedido_id: "c5", forma_entrega: "desconocida" }),
      venta({ pedido_id: "c6", cuenta_ml_id: "cuenta-b", forma_entrega: "desconocida", envio_agencia_congelado: null }),
      venta({ pedido_id: "c7" }),
    ].map(calcularUtilidadVenta);

    const total = totalizarUtilidad(resultados);
    expect(total.ventas_empaque_sin_dato).toBe(2);
    expect(total.ventas_envio_sin_dato).toBe(2);
    expect(total.ventas_forma_desconocida).toBe(2);

    const [cuentaA, cuentaB] = totalizarPorCuentaYMes(resultados);
    expect([cuentaA.ventas_empaque_sin_dato, cuentaA.ventas_envio_sin_dato, cuentaA.ventas_forma_desconocida]).toEqual([2, 1, 1]);
    expect([cuentaB.ventas_empaque_sin_dato, cuentaB.ventas_envio_sin_dato, cuentaB.ventas_forma_desconocida]).toEqual([0, 1, 1]);

    const limpio = totalizarUtilidad([resultados[6]]);
    expect([limpio.ventas_empaque_sin_dato, limpio.ventas_envio_sin_dato, limpio.ventas_forma_desconocida]).toEqual([0, 0, 0]);
  });

  it("montos grandes: sumas por encima de Number.MAX_SAFE_INTEGER centavos sin perder centavos", () => {
    const maximo = "999999999999.99"; // tope de numeric(14,2)
    const resultados = Array.from({ length: 1000 }, (_, i) =>
      calcularUtilidadVenta(
        venta({
          pedido_id: `grande-${i}`,
          valor_venta: maximo,
          comision_ml: "0.01",
          flete_ml: "0.00",
          empaque_congelado: "0.00",
          envio_agencia_congelado: "0.00",
          lineas: [
            linea({ linea: 1, valor_linea: "333333333333.33", costo_congelado: "0.01" }),
            linea({ linea: 2, valor_linea: "666666666666.66", costo_congelado: "0.00" }),
          ],
        }),
      ),
    );
    expect(resultados[0].utilidad).toBe("999999999999.97");
    expect(resultados[0].lineas.map((l) => l.valor_venta)).toEqual(["333333333333.33", "666666666666.66"]);

    const total = totalizarUtilidad(resultados);
    // 1000 × 99.999.999.999.997 centavos = 99.999.999.999.997.000 centavos,
    // muy por encima de Number.MAX_SAFE_INTEGER (≈ 9 × 10^15).
    expect(total.utilidad).toBe("999999999999970.00");
    expect(total.valor_venta).toBe("999999999999990.00");
    expect(total.comision_ml).toBe("10.00");
  });
});
