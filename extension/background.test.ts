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
// Revisión de Pablo (PR #260) — el mock de `chrome.storage.session` y
// `chrome.tabs.create` responde de forma ASÍNCRONA, con un pequeño
// retraso real (vía `setTimeout`, controlado con vi.useFakeTimers() +
// vi.advanceTimersByTimeAsync en cada prueba) — nunca síncrono. Esto
// es lo que de verdad expone el bug real del punto 1 (registrar/
// cerrar/desregistrar sin ninguna cola, pisándose entre sí cuando dos
// llamadas caen casi al mismo tiempo) — un mock síncrono nunca lo
// hubiera mostrado, porque cada get→set terminaría antes de que el
// siguiente arrancara.
const RETRASO_MOCK_MS = 10;
// Issue #252 (revisión de Pablo, punto 5) — mismo valor real que
// TIEMPO_ESPERA_SIN_NUEVAS_LECTURAS_MS en background.js (sin exportar,
// documentado acá para que las pruebas de tiempo tengan sentido sin
// tener que leer el archivo fuente al mismo tiempo).
const DEBOUNCE_MS = 5_000;
// Mismo valor real que TIEMPO_MAX_PESTANA_ACTUALIZAR_TODO_MS.
const TOPE_ABSOLUTO_MS = 45_000;

function crearChromeMock() {
  const storage: Record<string, unknown> = {};
  let siguienteTabId = 100;
  const listeners: {
    onMessage: ((mensaje: unknown, remitente: unknown) => void) | null;
    onActivated: ((info: { tabId: number }) => void) | null;
    onRemoved: ((tabId: number) => void) | null;
    onStartup: (() => void) | null;
  } = { onMessage: null, onActivated: null, onRemoved: null, onStartup: null };
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
      onStartup: {
        addListener: (fn: () => void) => {
          listeners.onStartup = fn;
        },
      },
    },
    storage: {
      session: {
        get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
          setTimeout(() => {
            const resultado: Record<string, unknown> = {};
            for (const key of Object.keys(defaults)) resultado[key] = key in storage ? storage[key] : defaults[key];
            cb(resultado);
          }, RETRASO_MOCK_MS);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          setTimeout(() => {
            Object.assign(storage, obj);
            cb?.();
          }, RETRASO_MOCK_MS);
        },
      },
    },
    tabs: {
      onActivated: {
        addListener: (fn: (info: { tabId: number }) => void) => {
          listeners.onActivated = fn;
        },
      },
      onRemoved: {
        addListener: (fn: (tabId: number) => void) => {
          listeners.onRemoved = fn;
        },
      },
      create: (props: { url: string; active: boolean }, cb?: (tab: { id: number }) => void) => {
        setTimeout(() => {
          const tab = { id: siguienteTabId++, url: props.url, active: props.active };
          llamadas.create.push(tab);
          cb?.(tab);
        }, RETRASO_MOCK_MS);
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

function lecturaTienda(mlIdExterno = "145150422") {
  return { tipoSeguimiento: "tienda" as const, mlIdExterno, totalPublicaciones: 23, idsVisibles: [], leidoEn: new Date().toISOString() };
}

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
  // El script se ejecuta entero al importarlo — incluida la barrida
  // "al cargar" (cerrarPestanasActualizarTodoVencidas(), ver issue
  // #252 punto 2) — se deja correr antes de seguir.
  await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);
}

describe("background.js — cierre automático de 'Actualizar todo' (issue #252, puntos 1/2/5)", () => {
  let mockActual: ReturnType<typeof crearChromeMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockActual = crearChromeMock();
    (globalThis as unknown as { chrome: unknown }).chrome = mockActual.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  async function abrirConActualizarTodo(links: string[]) {
    mockActual.listeners.onMessage!({ tipo: "zilonix:abrir-seguimientos", payload: { links } }, { tab: { url: URL_SEGUIMIENTO_STAGING } });
    // El chequeo de cooldown (storage.get) + cada chrome.tabs.create +
    // su propio registrarPestanaActualizarTodo (otro get→set) — todo
    // async, con retraso — se deja correr de sobra antes de seguir.
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 10);
    return mockActual.llamadas.create.map((t) => t.id);
  }

  // Dispara el mensaje real que manda content.js cuando la lectura de
  // la página está lista, y deja correr la barrida "el worker
  // despertó" (cerrarPestanasActualizarTodoVencidas, al principio del
  // listener) más la cola de promesas que agenda el cierre.
  async function mandarLectura(tabId: number, payload: ReturnType<typeof lecturaTienda> = lecturaTienda()) {
    mockActual.listeners.onMessage!({ tipo: "zilonix:dato-pagina-seguimiento", payload }, { tab: { id: tabId } });
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 6);
  }

  it("abre las pestañas reales (nunca falsea el id) — mismo comportamiento de siempre", async () => {
    await cargarBackgroundFresco();
    const ids = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422", "https://articulo.mercadolibre.com.co/MCO-1-x"]);
    expect(ids).toHaveLength(2);
    expect(mockActual.llamadas.create.every((t) => t.active === false)).toBe(true);
  });

  // Issue #252 (revisión de Pablo, punto 1) — bug real confirmado con
  // este mismo mock (storage con retraso real): sin la cola de
  // promesas (conPestanasActualizarTodo), de 4 pestañas registradas
  // casi al mismo tiempo (el `for` de "Actualizar todo", que llama
  // chrome.tabs.create 4 veces seguidas sin esperar entre sí), solo 2
  // quedaban en `pestanasActualizarTodo` — el último `set` pisaba el
  // trabajo de los demás. Con la cola, las 4 quedan registradas Y las
  // 4 se cierran solas.
  it("4 pestañas registradas casi al mismo tiempo: las 4 quedan registradas y las 4 se cierran, nunca se pisan entre sí", async () => {
    await cargarBackgroundFresco();
    const ids = await abrirConActualizarTodo([
      "https://listado.mercadolibre.com.co/_CustId_1",
      "https://listado.mercadolibre.com.co/_CustId_2",
      "https://listado.mercadolibre.com.co/_CustId_3",
      "https://listado.mercadolibre.com.co/_CustId_4",
    ]);
    expect(ids).toHaveLength(4);

    for (const tabId of ids) {
      await mandarLectura(tabId);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1_000); // deja pasar el debounce de las 4

    for (const tabId of ids) {
      expect(mockActual.llamadas.remove).toContain(tabId); // las 4, nunca solo 2
    }
  });

  // Issue #252 (revisión de Pablo, punto 5) — nunca cierra con la
  // PRIMERA lectura: espera un período sin lecturas NUEVAS de esa
  // pestaña antes de cerrarla (el MutationObserver de content.js
  // puede seguir completando datos).
  it("espera el debounce (sin lecturas nuevas) antes de cerrar — nunca al instante con la primera lectura", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    await mandarLectura(tabId);
    expect(mockActual.llamadas.remove).not.toContain(tabId); // todavía no, ni al instante

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1_000); // menos del debounce completo desde la lectura
    expect(mockActual.llamadas.remove).not.toContain(tabId);

    await vi.advanceTimersByTimeAsync(2_000); // ya pasó el debounce completo
    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("una lectura nueva reinicia la espera — nunca cierra a mitad de las relecturas del MutationObserver", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    await mandarLectura(tabId);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1_000); // todavía dentro del debounce de la primera
    await mandarLectura(tabId); // llega una relectura -> reinicia la espera
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1_000); // menos del debounce completo desde ESTA lectura
    expect(mockActual.llamadas.remove).not.toContain(tabId); // sigue sin cerrarse

    await vi.advanceTimersByTimeAsync(2_000); // ya pasó el debounce completo desde la última lectura
    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  // Issue #252 (revisión de Pablo, punto 5) — el tope absoluto de 45s
  // manda SIEMPRE, incluso si las relecturas nunca dejan que el
  // debounce llegue a disparar solo.
  it("el tope absoluto de 45s cierra la pestaña aunque las relecturas nunca paren (nunca se queda abierta para siempre)", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    // Relecturas cada 4s (siempre dentro del debounce de 5s, así que
    // NUNCA disparan el cierre por inactividad) durante más de 45s.
    for (let i = 0; i < 13; i++) {
      await mandarLectura(tabId);
      await vi.advanceTimersByTimeAsync(4_000);
    }
    // 13 * 4s = 52s desde que se abrió -> ya pasó el tope absoluto,
    // sin importar que la última relectura haya sido hace solo 4s.
    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("también la cierra (tras el debounce) cuando SÍ había una pestaña de Seguimiento abierta (la lectura se entrega, no se encola)", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);
    mockActual.setPestanasAbiertas([{ id: 1, url: URL_SEGUIMIENTO_STAGING }]);

    await mandarLectura(tabId);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1_000);

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("NUNCA cierra una pestaña que la extensión no abrió (un mensaje de una pestaña ajena, con un id que nunca pasó por 'Actualizar todo')", async () => {
    await cargarBackgroundFresco();

    await mandarLectura(999_999, {
      tipoSeguimiento: "tienda",
      mlIdExterno: "999",
      totalPublicaciones: 1,
      idsVisibles: [],
      leidoEn: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + TOPE_ABSOLUTO_MS); // de sobra, nunca debería cerrarla

    expect(mockActual.llamadas.remove).not.toContain(999_999);
  });

  it("si la persona activa (le da foco a) la pestaña, nunca la cierra — ni cuando llega la lectura, ni por el tope absoluto", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    mockActual.listeners.onActivated!({ tabId }); // la persona le hizo clic / le dio foco
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    await mandarLectura(tabId);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1_000);
    expect(mockActual.llamadas.remove).not.toContain(tabId); // la lectura llegó, pero la persona ya la estaba usando

    await vi.advanceTimersByTimeAsync(TOPE_ABSOLUTO_MS);
    expect(mockActual.llamadas.remove).not.toContain(tabId); // tampoco el tope absoluto, ya se desregistró
  });

  it("activar una pestaña que la extensión NUNCA abrió no hace nada (desregistrar un id que no estaba en la lista es un no-op seguro)", async () => {
    await cargarBackgroundFresco();
    expect(() => mockActual.listeners.onActivated!({ tabId: 123_456 })).not.toThrow();
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);
  });

  // Issue #252 (revisión de Pablo, punto 2) — bug real: el `setTimeout`
  // del tope absoluto vive en memoria del Service Worker — si Chrome
  // lo recicla por inactividad (justo lo más probable cuando la
  // lectura nunca llega, porque nada lo mantiene despierto), ese timer
  // se pierde. `vi.clearAllTimers()` simula exactamente eso: el reloj
  // sigue avanzando (chrome.storage.session SÍ sobrevive un reciclado
  // del worker), pero ningún timer dispara solo.
  it("si el Service Worker se recicla y pierde el timer de 45s, el próximo mensaje que llegue (cualquiera) la cierra igual — la barrida al despertar", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    vi.clearAllTimers(); // "el Service Worker se reció y perdió el timer"
    await vi.advanceTimersByTimeAsync(50_000); // el reloj avanza igual, nada dispara solo
    expect(mockActual.llamadas.remove).not.toContain(tabId); // todavía no, nadie disparó la barrida

    // Cualquier mensaje nuevo (no tiene que ser de esta pestaña ni de
    // un tipo relevante) dispara la barrida al principio del listener.
    mockActual.listeners.onMessage!({ tipo: "zilonix:algo-irrelevante" }, { tab: { id: 777_777 } });
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("activar CUALQUIER pestaña también dispara la barrida de vencidas (no solo un mensaje)", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(50_000);

    mockActual.listeners.onActivated!({ tabId: 888_888 }); // activa OTRA pestaña, nunca relacionada con la vencida
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it("chrome.runtime.onStartup también dispara la barrida de vencidas", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(50_000);

    mockActual.listeners.onStartup!();
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  it('"al cargar": si el Service Worker se reinicia (el script se vuelve a ejecutar), barre las vencidas que ya hubiera en storage', async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(mockActual.llamadas.remove).not.toContain(tabId);

    // El Service Worker "se reinicia": el script se vuelve a cargar
    // (vi.resetModules limpia el estado EN MEMORIA del módulo —
    // colaPestanasActualizarTodo, timersEsperaCierre — nunca el
    // storage simulado, que sigue vivo contra el MISMO mockActual.chrome).
    await cargarBackgroundFresco();

    expect(mockActual.llamadas.remove).toContain(tabId);
  });

  // Issue #252 (revisión de Pablo, punto 2) — si la persona cierra la
  // pestaña a mano ANTES de que llegue su lectura o de que pase el
  // tope absoluto, se desregistra apenas Chrome avisa que ya no
  // existe (chrome.tabs.onRemoved) — nunca se vuelve a intentar
  // cerrarla de nuevo (ni por una lectura tardía, ni por el tope).
  it("si la persona cierra la pestaña a mano (chrome.tabs.onRemoved), se desregistra — nunca se vuelve a intentar cerrar", async () => {
    await cargarBackgroundFresco();
    const [tabId] = await abrirConActualizarTodo(["https://listado.mercadolibre.com.co/_CustId_145150422"]);

    mockActual.listeners.onRemoved!(tabId); // la persona la cerró a mano
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);
    mockActual.llamadas.remove.length = 0; // onRemoved nunca llama chrome.tabs.remove por su cuenta — limpio por si acaso

    await vi.advanceTimersByTimeAsync(TOPE_ABSOLUTO_MS + 1_000); // deja pasar el tope absoluto también
    expect(mockActual.llamadas.remove).not.toContain(tabId); // ya no estaba registrada, nunca se reintenta
  });
});
