import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TarjetaDespachoCliente, type TarjetaDespachoProps } from "./TarjetaDespachoCliente";

// Issue "fechas equivocadas en Despachados" (punto 3) — sin DOM de
// navegador en el repo (mismo criterio que TablaDetalleAcordeon.test.tsx):
// se renderiza a HTML estático y se mira qué botón salió. useState usa
// su valor inicial (los props), useEffect no corre — alcanza porque el
// botón se decide solo con props, nunca con un efecto. useRouter() sí
// corre durante el render (no en un efecto) y revienta fuera de un App
// Router montado de verdad ("invariant expected app router to be
// mounted", bug real encontrado en CI) — se mockea, nunca se llama de
// verdad en este archivo.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function propsBase(extra: Partial<TarjetaDespachoProps> = {}): TarjetaDespachoProps {
  return {
    id: "despacho-1",
    logisticType: "self_service",
    status: "shipped",
    estadoTraducido: "En camino",
    despachadoTs: null,
    guiaVistaTs: new Date("2026-10-20T10:00:00Z"),
    cuentaNickname: "VENDEDOR_PRUEBA",
    pedidoIdExterno: "ORD-1",
    fechaPedido: new Date("2026-10-20T15:00:00Z"),
    comprador: null,
    bodegaAsignada: null,
    items: [],
    etiquetaTipo: "⚡ Flex",
    esFlex: true,
    chipPlazo: null,
    estadoPlazo: null,
    estadoEnvioTexto: "En camino",
    origenDespacho: null,
    puedeModificar: true,
    ventanaDeshacerMs: 10 * 60 * 1000,
    ...extra,
  };
}

describe("TarjetaDespachoCliente — botón 'Marcar despachado' en recogidos/entregados", () => {
  it("un envío recogido por la transportadora (sin marcar en Seller) NO muestra 'Marcar despachado', muestra 'Ya salió', y 'Ver guía' sigue", () => {
    const html = renderToStaticMarkup(<TarjetaDespachoCliente {...propsBase({ origenDespacho: "recogido_transportadora" })} />);
    expect(html).not.toContain("Marcar despachado");
    expect(html).toContain("Ya salió");
    expect(html).toContain("Ver guía (PDF)");
    expect(html).toContain("Ver guía (sticker)");
  });

  it("un envío todavía no recogido (pendiente real) sí muestra 'Marcar despachado'", () => {
    const html = renderToStaticMarkup(<TarjetaDespachoCliente {...propsBase({ origenDespacho: null, status: "ready_to_ship" })} />);
    expect(html).toContain("Marcar despachado");
    expect(html).not.toContain("Ya salió");
  });

  it("uno marcado en Seller (despachado_ts puesto) muestra Deshacer, sin ninguno de los dos botones de arriba", () => {
    const html = renderToStaticMarkup(
      <TarjetaDespachoCliente {...propsBase({ origenDespacho: "marcado_en_seller", despachadoTs: new Date() })} />
    );
    expect(html).not.toContain("Marcar despachado");
    expect(html).not.toContain("Ya salió");
    expect(html).toContain("Deshacer");
  });
});
