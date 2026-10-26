import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #252, punto 5 — Mateo confirmó que "Actualizar todo" SÍ abre
// las 4 pestañas, pero background.js nunca las cerraba — se quedaban
// abiertas para siempre. extension/background.js es un Service Worker
// de Manifest V3: no exporta nada (corre como script completo, nunca
// como módulo), así que estas pruebas son de integración real contra
// un `chrome` global simulado — se importa el archivo FRESCO en cada
// prueba (vi.resetModules + import dinámico) para que sus listeners
// queden registrados contra el mock de ESTA prueba puntual, nunca
// contra el de la anterior.
//
// El mock de `chrome.storage.session` es un objeto en memoria simple
// (get/set con callback, igual que la API real) — alcanza para probar
// el comportamiento real sin un navegador de verdad.
function crearChromeMock() {
  const storage: Record<string, unknown> = {};
  let siguienteTabId = 100;
  const listeners: { onMessage: ((mensaje: unknown, remitente: unknown) => void) | null; onActivated: ((info: { tabId: number }) => void) | null } = {
    onMessage: null,
    onActivated: null,
  };
  const llamadas = {
    create: [] as Array<{ id: number; url: string; active: boolean }>,
    remove: [] as number[],
  };
  // `pestanasAbiertas` — qué devuelve chrome.tabs.query({}) en esta
  // prueba puntual; por default ninguna (así que "dato-pagina-
  // seguimiento" siempre toma el camino "se encola", nunca necesita
  // una pestaña de Seguimiento real abierta para probar el cierre).
  let pestanasAbiertas: Array<{ id: number; url: string }> = [];

  const chrome = {
    runtime: {
      lastError: undefined as { message: string } | undefined,
      onMessage: {
        addListener: (fn: (mensaje: unknown, remitente: unknown) => void) => {
          listeners.onMessage = fn;
        },
      },
    },
    storage: {
      session: {
        get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
          const resultado: Record<string, unknown> = {};
          for (const key of Object.keys(defaults)) resultado[key] = key in storage ? storage[key] : defaults[key];
          cb(resultado);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          Object.assign(storage, obj);
          cb?.();
        },
      },
    },
    tabs: {
      onActivated: {
        addListener: (fn: (info: { tabId: number }) => void) => {
          listeners.onActivated = fn;
        },
      },
      create: (props: { url: string; active: boolean }, cb?: (tab: { id: number }) => void) => {
        const tab = { id: siguienteTabId++, url: props.url, active: props.active };
        llamadas.create.push(tab);
        cb?.(tab);
      },
      remove: (tabId: number, cb?: () => void) => {
        llamadas.remove.push(tabId);
        cb?.();
      },
      query: (_filtro: unknown, cb: (pestanas: Array<{ id: number; url: string }>) => void) => {
        cb(pestanasAbiertas);
      },
      sendMessage: (_tabId: number, _mensaje: unknown, cb?: (respuesta?: unknown) => void) => {
        cb?.();
      },
      update: (_tabId: number, _props: unknown, cb?: () => void) => {
        cb?.();
      },
    },
  };

  return {
    chrome,
    listeners,
    llamadas,
    setPestanasAbiertas: (pestanas: Array<{ id: number; url: string }>) => {
      pestanasAbiertas = pestanas;
    },
  };
}

const URL_SEGUIMIENTO_STAGING = "https://web-staging-d979.up.railway.app/panel/investigacion/seguimiento";

async function cargarBackgroundFresco() {
  vi.resetModules();
  // background.js es un script clásico (Service Worker de Manifest V3
  // SIN `"type": "module"` en manifest.json, a propósito: nunca se le
  // agrega `export`, eso rompería la extensión real con un
  // SyntaxError) — tsc lo trata como "no es un módulo" para un
  // `import()` dinámico. El import en sí funciona bien en runtime
  // (vitest/esbuild no exige que sea un módulo ES para importarlo por
  // sus efectos secundarios), así que se ignora solo ESTE error de
  // tipos, nunca el archivo entero.
  // @ts-expect-error — ver el comentario de arriba.
  await import("./background.js");
}

describe("background.js — cierre automático de 'Actualizar todo' (issue #252, punto 5)", () => {
  let mockActual: ReturnType<typeof crearChromeMock>;

  beforeEach(() => {
    mockActual = crearChromeMock();
    (globalThis as unknown as { chrome: unknown }).chrome = mockActual.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  function abrirConActualizarTodo(links: string[]) {
    mockActual.listeners.onMessage!({ tipo: "zilonix:abrir-seguimientos", payload: { links } }, { tab: { url: URL_SEGUIMIENTO_STAGING } });
    return mockActual.llamadas.create.map((t) => t.id);
  }

  it("abre las pestañas reales (nunca falsea el id) — mismo comportamiento de siempre", async () => {
    await cargarBackgroundFresco();
    const ids = abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422", "https://articulo.mercadolibre.com.co/MCO-1-x"]);
    expect(ids).toHaveLength(2);
    expect(mockActual.llamadas.create.every((t) => t.active === false)).toBe(true);
  });

  it("apenas llega la lectura de esa pestaña (zilonix:dato-pagina-seguimiento), la cierra sola", async () => {
    await cargarBackgroundFresco();
    const [tabId] = abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    mockActual.listeners.onMessage!(
      { tipo: "zilonix:dato-pagina-seguimiento", payload: { tipoSeguimiento: "tienda", mlIdExterno: "145150422", totalPublicaciones: 23, idsVisibles: [], leidoEn: new Date().toISOString() } },
      { tab: { id: tabId } }
    );

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("también la cierra cuando SÍ había una pestaña de Seguimiento abierta (la lectura se entrega, no se encola)", async () => {
    await cargarBackgroundFresco();
    const [tabId] = abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);
    mockActual.setPestanasAbiertas([{ id: 1, url: URL_SEGUIMIENTO_STAGING }]);

    mockActual.listeners.onMessage!(
      { tipo: "zilonix:dato-pagina-seguimiento", payload: { tipoSeguimiento: "tienda", mlIdExterno: "145150422", totalPublicaciones: 23, idsVisibles: [], leidoEn: new Date().toISOString() } },
      { tab: { id: tabId } }
    );

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("si la lectura nunca llega, la cierra igual a los 45s (nunca antes, nunca se queda abierta para siempre)", async () => {
    vi.useFakeTimers();
    await cargarBackgroundFresco();
    const [tabId] = abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    vi.advanceTimersByTime(44_000);
    expect(mockActual.llamadas.remove).not.toContain(tabId); // todavía no, nunca antes de los 45s

    vi.advanceTimersByTime(2_000); // total 46s
    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("NUNCA cierra una pestaña que la extensión no abrió (un mensaje de una pestaña ajena, con un id que nunca pasó por 'Actualizar todo')", async () => {
    await cargarBackgroundFresco();

    mockActual.listeners.onMessage!(
      { tipo: "zilonix:dato-pagina-seguimiento", payload: { tipoSeguimiento: "producto", mlIdExterno: "MCO999", inventario: 1, inventarioAproximado: false, vendidos: null, vendidosExacto: false, titulo: null, precio: null, leidoEn: new Date().toISOString() } },
      { tab: { id: 999999 } } // nunca lo abrió background.js
    );

    expect(mockActual.llamadas.remove).not.toContain(999999);
  });

  it("si la persona activa (le da foco a) la pestaña, nunca la cierra — ni cuando llega la lectura, ni a los 45s", async () => {
    vi.useFakeTimers();
    await cargarBackgroundFresco();
    const [tabId] = abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    mockActual.listeners.onActivated!({ tabId }); // la persona le hizo clic / le dio foco

    mockActual.listeners.onMessage!(
      { tipo: "zilonix:dato-pagina-seguimiento", payload: { tipoSeguimiento: "tienda", mlIdExterno: "145150422", totalPublicaciones: 23, idsVisibles: [], leidoEn: new Date().toISOString() } },
      { tab: { id: tabId } }
    );
    expect(mockActual.llamadas.remove).not.toContain(tabId); // la lectura llegó, pero la persona ya la estaba usando

    vi.advanceTimersByTime(60_000);
    expect(mockActual.llamadas.remove).not.toContain(tabId); // tampoco el respaldo de 45s, ya se desregistró
  });

  it("activar una pestaña que la extensión NUNCA abrió no hace nada (desregistrar un id que no estaba en la lista es un no-op seguro)", async () => {
    await cargarBackgroundFresco();
    expect(() => mockActual.listeners.onActivated!({ tabId: 123456 })).not.toThrow();
  });
});
