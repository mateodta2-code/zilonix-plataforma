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

// Bug real (rama fix-promociones-aprobadas-participando), reportado
// por Mateo en staging (cuenta sharel): "le doy Sí, la fila queda
// aprobada, pero en Aprobadas no aparece" — causa real: Dueño/Gerente
// (permiso "ejecutar" por default) pasan de "aceptada" a
// "ejecutada"/"fallida" casi al instante.
describe("PaginaPromociones — punto 1 (rama fix-promociones-aprobadas-participando): Aprobadas muestra el estado real", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("una fila 'ejecutada' en la pestaña Aprobadas muestra 'Ejecutada en ML', nunca un '—' vacío", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("filtro=aprobadas")) {
        return respuestaCandidatos([candidatoRaw({ estadoDecision: "ejecutada" })], { aprobadas: 1 });
      }
      if (url.includes("/candidatos")) return respuestaCandidatos([], { aprobadas: 1 });
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /Aprobadas/ }));

    expect(await screen.findByText("Ejecutada en ML")).toBeTruthy();
  });

  it("una fila 'fallida' muestra 'Falló al ejecutar' y el motivo real", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("filtro=aprobadas")) {
        return respuestaCandidatos([candidatoRaw({ estadoDecision: "fallida", motivoFalla: "El precio elegido supera el máximo permitido." })], { aprobadas: 1 });
      }
      if (url.includes("/candidatos")) return respuestaCandidatos([], { aprobadas: 1 });
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /Aprobadas/ }));

    expect(await screen.findByText("Falló al ejecutar")).toBeTruthy();
    expect(await screen.findByText("El precio elegido supera el máximo permitido.")).toBeTruthy();
  });
});

// Bug real (rama fix-promociones-aprobadas-participando), reportado
// por Mateo: "Sí" quedaba gris sin explicación cuando el techo real
// queda en o por debajo del piso de Finanzas (sin margen real).
describe("PaginaPromociones — punto 2 (rama fix-promociones-aprobadas-participando): 'Sin margen' explicado", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mínimo = máximo = precio mínimo de Finanzas: Sí deshabilitado con el motivo visible, no un gris sin explicación", async () => {
    const fetchMock = mockearFetchBase((url) =>
      url.includes("/candidatos")
        ? respuestaCandidatos([candidatoRaw({ precioMinimo: "149900", maxDiscountedPrice: "149900", precioOriginal: "199900", precioSugerido: "149900" })])
        : null
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    await screen.findByText("Producto de prueba");

    expect(estaDeshabilitado("Sí")).toBe(true);
    expect(await screen.findByText(/Sin margen: el mínimo/)).toBeTruthy();
  });
});

// Punto 3 (rama fix-promociones-aprobadas-participando): pestaña
// "Participando". IMPORTANTE: el POST /salir real hace un DELETE
// contra Mercado Libre — SIEMPRE mockeado acá, nunca real.
function filaParticipandoRaw(overrides: Record<string, unknown> = {}) {
  return {
    cuentaMlId: "cuenta-1",
    nicknameCuenta: "Cuenta 1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto participando",
    thumbnail: null,
    tipoPromocion: "PRICE_DISCOUNT",
    promotionIdMl: "PROMO-1",
    estadoMl: "started",
    precioOriginal: 100000,
    precioActual: 90000,
    precioMinimo: 85000,
    maxDiscountedPrice: 92000,
    gananciaEstimada: 30000,
    cumpleReglas: true,
    fechaInicio: "2026-11-01T00:00:00",
    fechaFin: "2026-11-30T23:59:59",
    puedeSalirApi: true,
    ...overrides,
  };
}

describe("PaginaPromociones — punto 3 (rama fix-promociones-aprobadas-participando): pestaña Participando", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("muestra 'Dejar de participar' cuando puedeSalirApi, y 'Solo desde ML' cuando no", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("/participando") && !url.includes("/salir")) {
        return new Response(JSON.stringify({ filas: [filaParticipandoRaw(), filaParticipandoRaw({ itemId: "MCO2", tipoPromocion: "DEAL", puedeSalirApi: false })] }), { status: 200 });
      }
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: "Participando" }));

    expect(await screen.findByRole("button", { name: "Dejar de participar" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Solo desde ML/ })).toBeTruthy();
  });

  it("Dejar de participar: pide confirmación, manda el POST (mockeado) y saca la fila de la lista con un toast", async () => {
    let cuerpoEnviado: Record<string, unknown> | null = null;
    const fetchMock = mockearFetchBase((url, init) => {
      if (url.includes("/participando/salir") && init?.method === "POST") {
        cuerpoEnviado = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/participando")) return new Response(JSON.stringify({ filas: [filaParticipandoRaw()] }), { status: 200 });
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: "Participando" }));
    await screen.findByText("Producto participando");

    fireEvent.click(screen.getByRole("button", { name: "Dejar de participar" }));

    await waitFor(() => expect(cuerpoEnviado).not.toBeNull());
    expect(cuerpoEnviado).toMatchObject({ cuentaId: "cuenta-1", itemId: "MCO1", promotionIdMl: "PROMO-1", tipoPromocion: "PRICE_DISCOUNT" });
    expect(await screen.findByText(/se salió de la promoción/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Producto participando")).toBeNull());
  });

  it("si la persona cancela la confirmación, nunca llama al POST", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("/participando/salir")) throw new Error("no debería llamarse");
      if (url.includes("/participando")) return new Response(JSON.stringify({ filas: [filaParticipandoRaw()] }), { status: 200 });
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: "Participando" }));
    await screen.findByText("Producto participando");

    fireEvent.click(screen.getByRole("button", { name: "Dejar de participar" }));
    await screen.findByText("Producto participando"); // sigue ahí, nada se mandó
  });
});

// BUG REAL, URGENTE (rama fix-promociones-aprobar-no-ejecuta) —
// confirmado en staging (cuenta sharel): aprobar con permiso de
// ejecutar activo mandaba la promoción real a ML sin pasar por este
// modal. Acá se prueba la mitad que vive en el cliente: "Lanzar"
// NUNCA llama a /acciones/ejecutar antes de que la persona escriba la
// palabra de confirmación — el fix del servidor (aprobar nunca
// ejecuta) tiene su propio test en acciones/route.test.ts.
describe("PaginaPromociones — punto 1 (rama fix-promociones-aprobar-no-ejecuta): Lanzar exige confirmación explícita", () => {
  afterEach(() => vi.unstubAllGlobals());

  function filaPendienteLanzar(overrides: Record<string, unknown> = {}) {
    return {
      id: "accion-1",
      cuentaMlId: "cuenta-1",
      nicknameCuenta: "Cuenta 1",
      itemId: "MCO1",
      tituloProducto: "VITALCARNITINA",
      tipoPromocion: "DEAL",
      precioAntes: "80000",
      precioDespues: "69900",
      ...overrides,
    };
  }

  it("el modal lista el producto/precio/cuenta y 'Confirmar y lanzar' arranca deshabilitado", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("/pendientes-lanzar")) return new Response(JSON.stringify({ total: 1, filas: [filaPendienteLanzar()] }), { status: 200 });
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /Lanzar aprobadas a Mercado Libre \(1\)/ }));

    expect(await screen.findByText("VITALCARNITINA")).toBeTruthy();
    expect(await screen.findByText("$69.900")).toBeTruthy();
    expect(estaDeshabilitado("Confirmar y lanzar")).toBe(true);
  });

  it("Lanzar NUNCA llama a /acciones/ejecutar hasta escribir la palabra de confirmación — después sí", async () => {
    let ejecutarLlamado = false;
    const fetchMock = mockearFetchBase((url, init) => {
      if (url.includes("/acciones/ejecutar") && init?.method === "POST") {
        ejecutarLlamado = true;
        return new Response(JSON.stringify({ ok: true, ejecutado: true, acciones: [{ estado: "ejecutada", tituloProducto: "VITALCARNITINA", error: null }] }), { status: 200 });
      }
      if (url.includes("/pendientes-lanzar")) return new Response(JSON.stringify({ total: 1, filas: [filaPendienteLanzar()] }), { status: 200 });
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /Lanzar aprobadas a Mercado Libre \(1\)/ }));
    await screen.findByText("VITALCARNITINA");

    // Clic con el botón todavía deshabilitado: no debería poder
    // dispararse nada (jsdom respeta disabled, pero lo confirmamos).
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y lanzar" }));
    expect(ejecutarLlamado).toBe(false);

    const inputConfirmacion = screen.getByRole("textbox");
    fireEvent.change(inputConfirmacion, { target: { value: "lanzar" } }); // minúsculas también cuentan
    expect(estaDeshabilitado("Confirmar y lanzar")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar y lanzar" }));
    await waitFor(() => expect(ejecutarLlamado).toBe(true));
  });

  it("si cancela, nunca llama a /acciones/ejecutar", async () => {
    const fetchMock = mockearFetchBase((url) => {
      if (url.includes("/acciones/ejecutar")) throw new Error("no debería llamarse");
      if (url.includes("/pendientes-lanzar")) return new Response(JSON.stringify({ total: 1, filas: [filaPendienteLanzar()] }), { status: 200 });
      if (url.includes("/candidatos")) return respuestaCandidatos([]);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaginaPromociones cuentas={[{ id: "cuenta-1", nickname: "Cuenta 1" }]} puedeAprobar={true} puedeEjecutar={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /Lanzar aprobadas a Mercado Libre \(1\)/ }));
    await screen.findByText("VITALCARNITINA");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("VITALCARNITINA")).toBeNull();
  });
});
