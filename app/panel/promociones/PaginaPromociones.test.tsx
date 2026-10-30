// @vitest-environment jsdom
//
// Rama fix-promociones-edicion — pruebas de componente (nueva
// infraestructura en este repo: @testing-library/react + jsdom, antes
// no existía ninguna; ver vitest.config.ts, ya traía `esbuild.jsx:
// "automatic"` preparado para esto). Reproduce los 3 bugs reales
// reportados por Mateo en staging (cuenta STOREKINGSAS):
//   1) los inputs de precio/% no dejaban escribir libre.
//   2) "Sí" no mostraba ningún resultado visible.
//   3) el % salía sin redondear en las filas de solo lectura (cubierto
//      también, a nivel de unidad, en calculosFila.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaginaPromociones } from "./PaginaPromociones";

// Este repo no usa los globals de vitest (`afterEach` se importa
// explícito arriba) — el auto-cleanup de @testing-library/react
// depende de detectar esos globals, así que sin esto cada test deja
// el render anterior montado y las búsquedas por rol empiezan a
// encontrar "elementos duplicados" de tests previos en el mismo archivo.
afterEach(() => cleanup());

// Sin @testing-library/jest-dom en este repo (no se agregó para no
// sumar más infraestructura de test de la estrictamente necesaria) —
// `.disabled` directo sobre el elemento real en vez del matcher
// `toBeDisabled()`.
function estaDeshabilitado(nombre: string): boolean {
  return (screen.getByRole("button", { name: nombre }) as HTMLButtonElement).disabled;
}

function candidatoRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    cuentaMlId: "cuenta-1",
    nicknameCuenta: "Cuenta 1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto de prueba",
    thumbnail: null,
    tieneVariantes: false,
    tipoPromocion: "DEAL",
    estadoMl: "candidate",
    esCompartida: false,
    soloEnMl: false,
    precioOriginal: "199900",
    precioActual: "149900",
    precioMinimo: "149900",
    precioSugerido: "149900",
    maxDiscountedPrice: "169900",
    gananciaEstimada: "40000",
    cumpleReglas: true,
    motivoRevisarManual: null,
    actualizadoTs: new Date().toISOString(),
    estadoDecision: null,
    motivoRechazo: null,
    ...overrides,
  };
}

function respuestaCandidatos(filas: unknown[], conteosExtra: Record<string, number> = {}) {
  return new Response(
    JSON.stringify({
      filas,
      conteos: { todas: filas.length, cumplen: 0, revisar: 0, "sin-minimo": 0, "solo-ml": 0, aprobadas: 0, rechazadas: 0, ...conteosExtra },
    }),
    { status: 200 }
  );
}

function mockearFetchBase(extra?: (url: string, init: RequestInit | undefined) => Response | null) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const personalizada = extra?.(url, init);
    if (personalizada) return personalizada;
    if (url.includes("/pendientes-lanzar")) return new Response(JSON.stringify({ total: 0 }), { status: 200 });
    throw new Error("ruta no mockeada en el test: " + url);
  });
}

describe("PaginaPromociones — punto 1 (rama fix-promociones-edicion): escribir libre, confirmar solo en blur/Enter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("escribir libre nunca se clampa a mitad de tecla (bug real: saltaba a 0/mínimo en cada onChange)", async () => {
    let getCount = 0;
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("/candidatos")) {
        getCount++;
        return respuestaCandidatos([candidatoRaw()]);
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await waitFor(() => expect(getCount).toBe(1));
    await screen.findByText("Producto de prueba");

    const [inputPrecio] = screen.getAllByRole("textbox");
    // Simula borrar todo y escribir un número chico, tecla por tecla —
    // el bug real clampeaba al mínimo (149.900) en cada una de estas.
    fireEvent.change(inputPrecio, { target: { value: "" } });
    expect((inputPrecio as HTMLInputElement).value).toBe("");
    fireEvent.change(inputPrecio, { target: { value: "1" } });
    expect((inputPrecio as HTMLInputElement).value).toBe("1");
    fireEvent.change(inputPrecio, { target: { value: "16" } });
    expect((inputPrecio as HTMLInputElement).value).toBe("16");
  });

  it("confirma (redondea, formato es-CO) solo en blur — un precio DENTRO de rango se acepta, el botón Sí sigue habilitado", async () => {
    const fetchMock = mockearFetchBase((url) => (url.includes("/candidatos") ? respuestaCandidatos([candidatoRaw()]) : null));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    const [inputPrecio] = screen.getAllByRole("textbox");
    // Formato real que alguien tipearía a mano: punto de miles.
    fireEvent.change(inputPrecio, { target: { value: "160.000" } });
    fireEvent.blur(inputPrecio);

    await waitFor(() => expect((inputPrecio as HTMLInputElement).value).toBe("160.000"));
    expect(screen.queryByText(/Tiene que estar entre/)).toBeNull();
    expect(estaDeshabilitado("Sí")).toBe(false);
  });

  it("confirma un precio FUERA de rango: se deja tal cual (nunca se fuerza de vuelta), avisa en rojo y bloquea Sí", async () => {
    const fetchMock = mockearFetchBase((url) => (url.includes("/candidatos") ? respuestaCandidatos([candidatoRaw()]) : null));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    const [inputPrecio] = screen.getAllByRole("textbox");
    fireEvent.change(inputPrecio, { target: { value: "16000" } }); // muy por debajo del mínimo (149.900)
    fireEvent.blur(inputPrecio);

    await waitFor(() => expect((inputPrecio as HTMLInputElement).value).toBe("16.000"));
    expect(await screen.findByText(/Tiene que estar entre/)).toBeTruthy();
    expect(estaDeshabilitado("Sí")).toBe(true);
  });

  it("Enter confirma igual que blur", async () => {
    const fetchMock = mockearFetchBase((url) => (url.includes("/candidatos") ? respuestaCandidatos([candidatoRaw()]) : null));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    const [inputPrecio] = screen.getAllByRole("textbox");
    fireEvent.change(inputPrecio, { target: { value: "165.000" } });
    fireEvent.keyDown(inputPrecio, { key: "Enter" });

    await waitFor(() => expect((inputPrecio as HTMLInputElement).value).toBe("165.000"));
  });

  it("Esc descarta el borrador y vuelve a mostrar el valor ya confirmado, sin tocar nada", async () => {
    const fetchMock = mockearFetchBase((url) => (url.includes("/candidatos") ? respuestaCandidatos([candidatoRaw()]) : null));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    const [inputPrecio] = screen.getAllByRole("textbox");
    const valorOriginal = (inputPrecio as HTMLInputElement).value; // 149.900 (precioSugerido del fixture)
    fireEvent.change(inputPrecio, { target: { value: "999" } });
    expect((inputPrecio as HTMLInputElement).value).toBe("999");
    fireEvent.keyDown(inputPrecio, { key: "Escape" });

    await waitFor(() => expect((inputPrecio as HTMLInputElement).value).toBe(valorOriginal));
    // Nunca quedó bloqueado por el 999 que se descartó.
    expect(estaDeshabilitado("Sí")).toBe(false);
  });

  it("escribir en % recalcula el precio solo al confirmar, con coma decimal es-CO", async () => {
    const fetchMock = mockearFetchBase((url) => (url.includes("/candidatos") ? respuestaCandidatos([candidatoRaw()]) : null));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    const [inputPrecio, inputDescuento] = screen.getAllByRole("textbox");
    fireEvent.change(inputDescuento, { target: { value: "15,0" } }); // 15% de 199.900 = 169.915 -> redondea a 169.915
    fireEvent.blur(inputDescuento);

    await waitFor(() => expect((inputPrecio as HTMLInputElement).value).toBe("169.915"));
  });
});

describe("PaginaPromociones — punto 3 (rama fix-promociones-edicion): % redondeado a 1 decimal, formato es-CO, también de solo lectura", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("una fila de solo lectura (soloEnMl) muestra el % redondeado con coma decimal, nunca el número crudo", async () => {
    const fetchMock = mockearFetchBase((url) =>
      url.includes("/candidatos")
        ? respuestaCandidatos([candidatoRaw({ soloEnMl: true, precioSugerido: null, precioOriginal: "100000", precioActual: "93333" })])
        : null
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    // (100000-93333)/100000*100 = 6.667...% -> "6,7%", nunca el crudo.
    expect(await screen.findByText("6,7%")).toBeTruthy();
  });
});

describe("PaginaPromociones — punto 2 (rama fix-promociones-edicion): Sí es una decisión directa, con toast", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Sí con respuesta ok: llama a POST /acciones con precioElegido, muestra un toast de éxito y recarga Aprobadas", async () => {
    let getCount = 0;
    let cuerpoEnviado: Record<string, unknown> | null = null;
    const fetchMock = mockearFetchBase((url, init) => {
      if (url.includes("/candidatos")) {
        getCount++;
        return getCount === 1 ? respuestaCandidatos([candidatoRaw()]) : respuestaCandidatos([], { aprobadas: 1 });
      }
      if (url.includes("/acciones") && init?.method === "POST") {
        cuerpoEnviado = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true, ejecutado: false, acciones: [{ id: "a1", estado: "aceptada", error: null }] }), { status: 200 });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    fireEvent.click(screen.getByRole("button", { name: "Sí" }));

    await waitFor(() => expect(cuerpoEnviado).not.toBeNull());
    expect(cuerpoEnviado).toMatchObject({
      decisiones: [{ candidatoId: "c1", accion: "participar", precioElegido: 149900, decision: "aprobar" }],
    });

    expect(await screen.findByText("Aprobado — pasó a la pestaña Aprobadas.")).toBeTruthy();
    await waitFor(() => expect(getCount).toBe(2));
  });

  it("Sí con rechazo blando (HTTP 200, estado 'rechazada'): el toast muestra el motivo real, nunca un 'listo' silencioso", async () => {
    const fetchMock = mockearFetchBase((url, init) => {
      if (url.includes("/candidatos")) return respuestaCandidatos([candidatoRaw()]);
      if (url.includes("/acciones") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ ok: true, ejecutado: false, acciones: [{ id: "a1", estado: "rechazada", error: "El precio elegido supera el máximo que permite esta promoción." }] }),
          { status: 200 }
        );
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    fireEvent.click(screen.getByRole("button", { name: "Sí" }));

    expect(await screen.findByText("El precio elegido supera el máximo que permite esta promoción.")).toBeTruthy();
  });

  it("si el fetch se cae (red), nunca se queda 'sin pasar nada' — muestra un toast y el botón vuelve a habilitarse", async () => {
    const fetchMock = mockearFetchBase((url, init) => {
      if (url.includes("/candidatos")) return respuestaCandidatos([candidatoRaw()]);
      if (url.includes("/acciones") && init?.method === "POST") throw new Error("network down");
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    fireEvent.click(screen.getByRole("button", { name: "Sí" }));

    expect(await screen.findByText(/No se pudo guardar/)).toBeTruthy();
    await waitFor(() => expect(estaDeshabilitado("Sí")).toBe(false));
  });
});
