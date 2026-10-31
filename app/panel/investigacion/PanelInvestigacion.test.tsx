// @vitest-environment jsdom
//
// Rama fix-investigacion-busquedas-1h (Refs #227) — reproduce en jsdom
// el reporte real de Mateo en staging: busca "zapatos" (A), espera
// resultados, busca "relojes" (B) y los resultados de A "se pierden".
//
// FormularioAnalizar.tsx usa <form method="get"> SIN preventDefault
// -> navegación completa del navegador -> PanelInvestigacion se
// desmonta y se vuelve a montar de cero en la página nueva (nunca un
// cambio de prop `termino` sobre la MISMA instancia). Por eso cada
// búsqueda acá es un render()/unmount() nuevo — no un rerender — para
// no asumir algo que el código real nunca garantiza.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PanelInvestigacion } from "./PanelInvestigacion";
import { marcarClicAnalizar } from "./analizarClic";

// El título de un producto puede aparecer dos veces (la celda de la
// tabla + el banner "Mejor opción para importar") — getByText revienta
// con "multiple elements"; esto solo confirma que aparece al menos una.
function aparece(texto: string | RegExp): boolean {
  return screen.queryAllByText(texto).length > 0;
}

// ./actions.ts es una Server Action ("use server") que termina
// importando db/index.ts (exige DATABASE_URL_APP). Este test nunca
// dispara un escaneo real (ver dispatchListadoImportado abajo) —
// mockeado solo para poder importar PanelInvestigacion.tsx en vitest.
vi.mock("./actions", () => ({
  generarQueriesAnalizarAction: async (termino: string) => [termino],
  generarQueriesPlataformaAction: async () => [],
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-zilonix-extension");
});

function productoWire(titulo: string) {
  return { titulo, precio: 10000, vendidos: 5, link: "https://example.com/" + encodeURIComponent(titulo) };
}

// Simula el mensaje real que manda extension/background.js cuando un
// escaneo autorizado por "Analizar" (payload.origen === "escaneo-analizar")
// termina — el único camino por el que PanelInvestigacion agrega un
// bloque nuevo sin pedir confirmación.
// window.postMessage real encola una macrotarea en jsdom (no corre
// síncrono dentro de act()) — se dispara el MessageEvent directo,
// igual al que terminaría recibiendo el listener de PanelInvestigacion
// (mismo chequeo: origin propio + source === window).
function dispatchListadoImportado(plataforma: string, productos: unknown[]) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { fuente: "zilonix-extension", tipo: "listado-importado", payload: { plataforma, productos, origen: "escaneo-analizar" } },
        origin: window.location.origin,
        source: window,
      })
    );
  });
}

describe("PanelInvestigacion — una búsqueda no debe desaparecer al buscar otra (Refs #227)", () => {
  it("buscar A, luego B (navegación completa) y volver a A: A sigue accesible sin volver a escanear", async () => {
    // --- Búsqueda A: primera carga de página con ?termino=zapatos ---
    const { unmount: unmountA } = render(<PanelInvestigacion termino="zapatos" tab="demanda" />);
    await waitFor(() => expect(screen.getByText(/todavía no hay ningún bloque/i)).toBeTruthy());
    dispatchListadoImportado("Mercado Libre Colombia", [productoWire("Zapato A")]);
    await waitFor(() => expect(aparece("Zapato A")).toBe(true));
    unmountA(); // <- simula la navegación completa del <form method="get">

    // --- Búsqueda B: segunda carga de página con ?termino=relojes ---
    const { unmount: unmountB } = render(<PanelInvestigacion termino="relojes" tab="demanda" />);
    // Requisito de la tarea: "visibles o accesibles" — tiene que haber
    // ALGO en esta misma pantalla que permita llegar a "zapatos" sin
    // adivinar una URL. Si esto no aparece, A quedó enterrada.
    await waitFor(() => expect(aparece(/zapatos/i)).toBe(true));
    dispatchListadoImportado("Mercado Libre Colombia", [productoWire("Reloj B")]);
    await waitFor(() => expect(aparece("Reloj B")).toBe(true));
    unmountB();

    // --- Volver a A (nueva carga de página, SIN disparar ningún escaneo) ---
    render(<PanelInvestigacion termino="zapatos" tab="demanda" />);
    await waitFor(() => expect(aparece("Zapato A")).toBe(true));
  });

  it("si el escaneo de A sigue en curso al pasar a B (navegación de cliente, sin desmontar), el resultado tardío de A se guarda en SU sesión, nunca mezclado con B", async () => {
    document.documentElement.setAttribute("data-zilonix-extension", "true");
    marcarClicAnalizar("CO", "ml"); // mismo marcado que hace FormularioAnalizar.onSubmit antes de navegar

    const { rerender } = render(<PanelInvestigacion termino="zapatos" tab="demanda" />);
    // El "clic reciente" dispara escanearMercadoLibre("zapatos") solo —
    // esperamos a que el escaneo quede marcado en curso antes de "irnos" a B.
    await waitFor(() => expect(aparece(/Escaneando Mercado Libre/i)).toBe(true));

    // Búsqueda B: mismo componente, prop `termino` nueva (lo que hace
    // ahora FormularioAnalizar con router.push, nunca un remount) — el
    // escaneo de A sigue viajando, nadie lo cancela.
    rerender(<PanelInvestigacion termino="relojes" tab="demanda" />);

    // Llega tarde el resultado de A, DESPUÉS de que la pantalla ya
    // muestra B — nunca debe aparecer mezclado en lo que se ve ahora.
    dispatchListadoImportado("Mercado Libre Colombia", [productoWire("Zapato Tardio")]);
    await waitFor(() => expect(aparece(/relojes/i)).toBe(true));
    expect(aparece("Zapato Tardio")).toBe(false);

    // Pero no se perdió: sigue accesible en su propia búsqueda, sin
    // volver a escanear (no se dispara ningún mensaje nuevo acá).
    rerender(<PanelInvestigacion termino="zapatos" tab="demanda" />);
    await waitFor(() => expect(aparece("Zapato Tardio")).toBe(true));
  });
});
