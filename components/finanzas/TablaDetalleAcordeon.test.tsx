import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiaDetalle, ProductoDetalle, TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { TablaDetalleAcordeon } from "./TablaDetalleAcordeon";

// Issue #131 — estado inicial del acordeón del detalle día a día. Sin
// DOM de navegador en el repo: se renderiza a HTML y se mira qué filas
// salen (lo cerrado no se pinta).

const TOTALES: TotalesDetalle = {
  ventas: 1,
  ventas_sin_costo: 0,
  recaudo: "50000.00",
  recaudo_sin_costo: "0.00",
  comision_ml: "6000.00",
  flete_ml: "0.00",
  costo_producto: "20000.00",
  empaque: "1000.00",
  envio: "2000.00",
  utilidad: "21000.00",
  porcentaje_utilidad: "42.00",
  porcentaje_ml: "12.00",
  cantidad: 1,
};

function producto(pedidoId: string, titulo: string): ProductoDetalle {
  const { costo_producto, utilidad, ...resto } = TOTALES;
  return {
    ...resto,
    pedido_id: pedidoId,
    linea: 1,
    titulo,
    sku_codigo: `SKU-${pedidoId}`,
    forma_entrega: "agencia",
    fecha_creacion: new Date("2026-10-20T15:00:00Z"),
    costo_producto,
    utilidad,
    porcentaje_ventas_con_costo: "100.00",
  } as ProductoDetalle;
}

function dia(fecha: string, cuentas: [string, string][]): DiaDetalle {
  return {
    dia: fecha,
    numero_cuentas: cuentas.length,
    numero_ventas: cuentas.length,
    totales: TOTALES,
    cuentas: cuentas.map(([nickname, pedidoId]) => ({
      cuenta_ml_id: `cuenta-${nickname}`,
      nickname,
      numero_ventas: 1,
      totales: TOTALES,
      productos: [producto(pedidoId, `Producto ${pedidoId}`)],
    })),
  };
}

const ENCABEZADOS = ["Día · cuenta · producto", "Nº ventas"];

function pintar(dias: DiaDetalle[], conDevolucion: string[] = []) {
  const pedidoIdExterno = Object.fromEntries(dias.flatMap((d) => d.cuentas.flatMap((c) => c.productos.map((p) => [p.pedido_id, `ML${p.pedido_id}`]))));
  return renderToStaticMarkup(<TablaDetalleAcordeon encabezados={ENCABEZADOS} dias={dias} pedidoIdExterno={pedidoIdExterno} conDevolucion={conDevolucion} />);
}

describe("TablaDetalleAcordeon (issue #131)", () => {
  it("arranca con el día más nuevo abierto, con todas sus cuentas abiertas; los demás días cerrados", () => {
    const html = pintar([
      dia("2026-10-29", [
        ["STOREKING", "p1"],
        ["FMC", "p2"],
      ]),
      dia("2026-10-28", [["STOREKING", "p3"]]),
    ]);
    // Los dos días se ven siempre.
    expect(html).toContain("2026-10-29 · 2 cta · 2 vtas");
    expect(html).toContain("2026-10-28 · 1 cta · 1 vta");
    // Del día abierto: sus dos cuentas y sus productos, con link y número de ML.
    expect(html).toContain("STOREKING · 1 Vta");
    expect(html).toContain("FMC · 1 Vta");
    expect(html).toContain('href="/panel/finanzas/ventas/p1"');
    expect(html).toContain("#MLp2");
    // Del día cerrado: nada.
    expect(html).not.toContain("/panel/finanzas/ventas/p3");
    // aria-expanded: 2 días (true, false) y 2 cuentas abiertas.
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
  });

  it("el día más nuevo se elige por fecha, no por posición", () => {
    const html = pintar([dia("2026-10-27", [["A", "viejo"]]), dia("2026-10-30", [["B", "nuevo"]])]);
    expect(html).toContain("/panel/finanzas/ventas/nuevo");
    expect(html).not.toContain("/panel/finanzas/ventas/viejo");
  });

  it("marca la devolución solo en su pedido y no pinta nada sin días", () => {
    const html = pintar([dia("2026-10-29", [["A", "d1"], ["B", "d2"]])], ["d2"]);
    expect(html.match(/Con devolución: revisar/g)).toHaveLength(1);
    expect(pintar([])).not.toContain("aria-expanded");
  });
});
