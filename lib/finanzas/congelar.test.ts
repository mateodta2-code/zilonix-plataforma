import { describe, expect, it } from "vitest";
import { congelarPaquete, type EntradaCongelar, type MaestraSku } from "./congelar";

// Issue #130 (Z-FIN-08) — reglas de la foto congelada, sin base.

function sku(datos: Partial<MaestraSku>): MaestraSku {
  return { costo: null, empaque: null, empaqueProveedor: null, envioAgencia: null, ...datos };
}

function entrada(datos: Partial<EntradaCongelar> & Pick<EntradaCongelar, "maestra">): EntradaCongelar {
  return {
    formaEntrega: "agencia",
    flexValor: null,
    ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "50000.00", skuCodigo: "REF-1" }] }],
    ...datos,
  };
}

describe("congelarPaquete (issue #130)", () => {
  it("costo 0.00 congela sin alerta; costo vacío o SKU fuera de la maestra quedan sin costo", () => {
    const conCero = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: "0.00", empaque: "1000", envioAgencia: "2000" })]]) }));
    expect(conCero.ordenes[0]).toMatchObject({ congelar: true, estadoCosteo: "completo", lineas: [{ costo: "0.00" }] });
    expect(conCero.alertas).toEqual([]);

    const vacio = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: null })]]) }));
    expect(vacio.ordenes[0]).toMatchObject({ congelar: false, estadoCosteo: "sin_costo", empaque: null, envio: null, lineas: [{ costo: null }] });
    expect(vacio.alertas).toContainEqual({ tipo: "sin_costo", pedidoId: "p1", linea: 1, skuCodigo: "REF-1" });

    const fuera = congelarPaquete(entrada({ maestra: new Map() }));
    expect(fuera.ordenes[0]).toMatchObject({ congelar: false, estadoCosteo: "sin_costo" });

    const sinSku = congelarPaquete(
      entrada({ maestra: new Map(), ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "1.00", skuCodigo: null }] }] })
    );
    expect(sinSku.ordenes[0].congelar).toBe(false);
  });

  it("una línea sin costo deja la venta parcial y sin congelar", () => {
    const r = congelarPaquete(
      entrada({
        maestra: new Map([["REF-1", sku({ costo: "10000" })]]),
        ordenes: [
          {
            pedidoId: "p1",
            lineas: [
              { linea: 1, cantidad: 1, valorLinea: "50000.00", skuCodigo: "REF-1" },
              { linea: 2, cantidad: 1, valorLinea: "50000.00", skuCodigo: "REF-2" },
            ],
          },
        ],
      })
    );
    expect(r.ordenes[0]).toMatchObject({ estadoCosteo: "parcial", congelar: false });
    expect(r.ordenes[0].lineas.every((l) => l.costo === null)).toBe(true);
  });

  it("el costo de la línea es unitario × cantidad", () => {
    const r = congelarPaquete(
      entrada({
        maestra: new Map([["REF-1", sku({ costo: "12345.67" })]]),
        ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 3, valorLinea: "90000.00", skuCodigo: "REF-1" }] }],
      })
    );
    expect(r.ordenes[0].lineas[0].costo).toBe("37037.01");
  });

  it("dos líneas en un paquete cobran empaque y envío una vez (el mayor) y las líneas suman exacto", () => {
    const r = congelarPaquete(
      entrada({
        maestra: new Map([
          ["A", sku({ costo: "1000", empaque: "1500", envioAgencia: "2000" })],
          ["B", sku({ costo: "1000", empaque: "3000", envioAgencia: "1000" })],
        ]),
        ordenes: [
          {
            pedidoId: "p1",
            lineas: [
              { linea: 1, cantidad: 1, valorLinea: "10000.00", skuCodigo: "A" },
              { linea: 2, cantidad: 2, valorLinea: "20000.00", skuCodigo: "B" },
            ],
          },
        ],
      })
    );
    const orden = r.ordenes[0];
    expect(orden).toMatchObject({ congelar: true, empaque: "3000.00", envio: "2000.00" });
    // Reparto por peso 1:2, con suma exacta.
    expect(orden.lineas.map((l) => l.empaque)).toEqual(["1000.00", "2000.00"]);
    expect(orden.lineas.map((l) => l.envio)).toEqual(["666.67", "1333.33"]);
  });

  it("reparto con redondeo: la suma de las líneas es exactamente el total", () => {
    const lineas = [1, 2, 3].map((linea) => ({ linea, cantidad: 1, valorLinea: "33333.33", skuCodigo: "A" }));
    const r = congelarPaquete(entrada({ maestra: new Map([["A", sku({ costo: "1", empaque: "1000.00", envioAgencia: "100.00" })]]), ordenes: [{ pedidoId: "p1", lineas }] }));
    const centavos = (valores: (string | null)[]) => valores.reduce((s, v) => s + Math.round(Number(v) * 100), 0);
    expect(centavos(r.ordenes[0].lineas.map((l) => l.empaque))).toBe(100000);
    expect(centavos(r.ordenes[0].lineas.map((l) => l.envio))).toBe(10000);
    expect(r.ordenes[0].lineas.map((l) => l.envio)).toEqual(["33.34", "33.33", "33.33"]);
  });

  it("SKU con prefijo FUL y envío agencia 2.000: por agencia congela $2.000, con Full $0; el packing se cobra igual", () => {
    const maestra = new Map([["FUL-INF-01", sku({ costo: "5000", empaque: "2000", envioAgencia: "2000" })]]);
    const ordenes = [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "30000.00", skuCodigo: "FUL-INF-01" }] }];

    const agencia = congelarPaquete({ formaEntrega: "agencia", flexValor: null, maestra, ordenes });
    expect(agencia.ordenes[0]).toMatchObject({ empaque: "2000.00", envio: "2000.00" });

    const full = congelarPaquete({ formaEntrega: "full_ml", flexValor: null, maestra, ordenes });
    expect(full.ordenes[0]).toMatchObject({ congelar: true, empaque: "2000.00", envio: "0.00", lineas: [{ empaque: "2000.00", envio: "0.00" }] });
  });

  it("Flex usa flex_valor; sin flex_valor no congela y alerta", () => {
    const maestra = new Map([["REF-1", sku({ costo: "100", empaque: "500", envioAgencia: "2000" })]]);
    const conValor = congelarPaquete(entrada({ maestra, formaEntrega: "flex", flexValor: "7500" }));
    expect(conValor.ordenes[0]).toMatchObject({ congelar: true, envio: "7500.00" });

    const sinValor = congelarPaquete(entrada({ maestra, formaEntrega: "flex", flexValor: null }));
    expect(sinValor.ordenes[0].congelar).toBe(false);
    expect(sinValor.alertas).toContainEqual({ tipo: "flex_sin_valor" });
  });

  it("forma de entrega desconocida no congela y alerta, aunque haya costo", () => {
    const r = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: "100" })]]), formaEntrega: "desconocida" }));
    expect(r.ordenes[0]).toMatchObject({ congelar: false, estadoCosteo: "completo" });
    expect(r.alertas).toContainEqual({ tipo: "forma_entrega_desconocida" });
  });

  it("sin packing propio usa el del proveedor; 0 propio es $0 real; sin ninguno queda vacío con alerta", () => {
    const delProveedor = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: "1", empaqueProveedor: "2000", envioAgencia: "0" })]]) }));
    expect(delProveedor.ordenes[0]).toMatchObject({ empaque: "2000.00", envio: "0.00" });

    const ceroPropio = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: "1", empaque: "0", empaqueProveedor: "2000" })]]) }));
    expect(ceroPropio.ordenes[0].empaque).toBe("0.00");

    const sinDato = congelarPaquete(entrada({ maestra: new Map([["REF-1", sku({ costo: "1" })]]) }));
    expect(sinDato.ordenes[0]).toMatchObject({ congelar: true, empaque: null, envio: null, lineas: [{ empaque: null, envio: null }] });
    expect(sinDato.alertas).toEqual([{ tipo: "empaque_sin_dato" }, { tipo: "envio_sin_dato" }]);
  });

  it("carrito: dos órdenes del mismo envío reparten el cargo una vez, por peso", () => {
    const r = congelarPaquete({
      formaEntrega: "agencia",
      flexValor: null,
      maestra: new Map([["A", sku({ costo: "1", empaque: "3000", envioAgencia: "2000" })]]),
      ordenes: [
        { pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "30000.00", skuCodigo: "A" }] },
        { pedidoId: "p2", lineas: [{ linea: 1, cantidad: 1, valorLinea: "10000.00", skuCodigo: "A" }] },
      ],
    });
    expect(r.ordenes.map((o) => [o.empaque, o.envio])).toEqual([
      ["2250.00", "1500.00"],
      ["750.00", "500.00"],
    ]);
  });

  it("carrito con una orden ya congelada: la nueva paga solo la diferencia contra el mayor", () => {
    const maestra = new Map([
      ["A", sku({ costo: "1", empaque: "2000", envioAgencia: "2000" })],
      ["B", sku({ costo: "1", empaque: "3000", envioAgencia: "1000" })],
    ]);
    const ordenes = [{ pedidoId: "p2", lineas: [{ linea: 1, cantidad: 1, valorLinea: "10000.00", skuCodigo: "B" }] }];
    const r = congelarPaquete({ formaEntrega: "agencia", flexValor: null, maestra, ordenes, yaCobrado: { empaque: "2000.00", envio: "2000.00" } });
    expect(r.ordenes[0]).toMatchObject({ empaque: "1000.00", envio: "0.00" });
  });
});

describe("congelarPaquete con SKU combo X2/X3 (Sharel, 29-oct-2026)", () => {
  const BASE = sku({ costo: "10000.00", empaque: "1000.00", envioAgencia: "5000.00" });

  it("BASEX2 sin fila exacta: costo de la base × 2 × cantidad; empaque y envío una vez, sin multiplicar", () => {
    const r = congelarPaquete(
      entrada({
        maestra: new Map([["BASE", BASE]]),
        ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 2, valorLinea: "80000.00", skuCodigo: "BASEX2" }] }],
      })
    );
    expect(r.alertas).toEqual([]);
    expect(r.ordenes[0]).toMatchObject({
      congelar: true,
      empaque: "1000.00",
      envio: "5000.00",
      lineas: [{ costo: "40000.00", empaque: "1000.00", envio: "5000.00", origenCosto: "combo_base" }],
    });
  });

  it("la fila exacta con empaque y envío propios: se usan los de la exacta", () => {
    const exacta = sku({ costo: null, empaque: "1500.00", envioAgencia: "6000.00" });
    const r = congelarPaquete(
      entrada({
        maestra: new Map([["BASE", BASE], ["BASEX2", exacta]]),
        ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "40000.00", skuCodigo: "BASEX2" }] }],
      })
    );
    expect(r.ordenes[0]).toMatchObject({ empaque: "1500.00", envio: "6000.00", lineas: [{ costo: "20000.00", origenCosto: "combo_base" }] });

    const conCosto = congelarPaquete(
      entrada({
        maestra: new Map([["BASE", BASE], ["BASEX2", sku({ costo: "18000.00", empaque: "1500.00", envioAgencia: "6000.00" })]]),
        ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "40000.00", skuCodigo: "BASEX2" }] }],
      })
    );
    expect(conCosto.ordenes[0].lineas[0]).toMatchObject({ costo: "18000.00", origenCosto: "exacto" });
  });

  it("paquete con BASEX3 y otro SKU: empaque y envío siguen siendo el mayor, una sola vez", () => {
    const r = congelarPaquete(
      entrada({
        maestra: new Map([["BASE", BASE], ["OTRO", sku({ costo: "3000.00", empaque: "2000.00", envioAgencia: "4000.00" })]]),
        ordenes: [
          {
            pedidoId: "p1",
            lineas: [
              { linea: 1, cantidad: 1, valorLinea: "60000.00", skuCodigo: "BASEX3" },
              { linea: 2, cantidad: 1, valorLinea: "20000.00", skuCodigo: "OTRO" },
            ],
          },
        ],
      })
    );
    expect(r.ordenes[0]).toMatchObject({ empaque: "2000.00", envio: "5000.00" });
    expect(r.ordenes[0].lineas.map((l) => [l.costo, l.origenCosto])).toEqual([
      ["30000.00", "combo_base"],
      ["3000.00", "exacto"],
    ]);
  });

  it("Full: envío $0 también con combo", () => {
    const r = congelarPaquete(
      entrada({
        formaEntrega: "full_ml",
        maestra: new Map([["BASE", BASE]]),
        ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "40000.00", skuCodigo: "BASEX2" }] }],
      })
    );
    expect(r.ordenes[0]).toMatchObject({ congelar: true, empaque: "1000.00", envio: "0.00", lineas: [{ costo: "20000.00" }] });
  });

  it("AGUJA2 y BASEX4 no son combo: siguen sin costo", () => {
    for (const skuCodigo of ["AGUJA2", "BASEX4"]) {
      const r = congelarPaquete(
        entrada({
          maestra: new Map([["AGUJA", BASE], ["BASE", BASE]]),
          ordenes: [{ pedidoId: "p1", lineas: [{ linea: 1, cantidad: 1, valorLinea: "1.00", skuCodigo }] }],
        })
      );
      expect(r.ordenes[0]).toMatchObject({ congelar: false, estadoCosteo: "sin_costo", lineas: [{ costo: null, origenCosto: null }] });
    }
  });
});
