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
// Mismos valores reales que COOLDOWN_IMPORTAR_LINK_MS/TIEMPO_MAX_IMPORTAR_LINK_MS
// en background.js (anexo #44/#273, "Importar por link").
const COOLDOWN_IMPORTAR_LINK_MS = 5_000;
const TIEMPO_MAX_IMPORTAR_LINK_MS = 30_000;

function crearChromeMock() {
  const storageSession: Record<string, unknown> = {};
  const storageLocal: Record<string, unknown> = {};
  let siguienteTabId = 100;
  const listeners: {
    onMessage: ((mensaje: unknown, remitente: unknown, sendResponse?: (respuesta?: unknown) => void) => boolean | void) | null;
    onActivated: ((info: { tabId: number }) => void) | null;
    onRemoved: ((tabId: number) => void) | null;
    onStartup: (() => void) | null;
    onClicked: ((tab: { id?: number }) => void) | null;
  } = { onMessage: null, onActivated: null, onRemoved: null, onStartup: null, onClicked: null };
  // Issue #44/#273 (anexo "Importar por link") — a diferencia de los
  // demás eventos de arriba (un solo listener, registrado una vez al
  // cargar el script), chrome.tabs.onUpdated se registra y desregistra
  // UNA VEZ POR CADA LECTURA (iniciarImportarLink lo agrega, y lo quita
  // apenas resuelve el link o se cancela) — por eso necesita un
  // registro real de varios listeners, nunca un solo slot.
  const listenersOnUpdated: Array<(tabId: number, cambioInfo: { status?: string }, tab: { id: number; url: string }) => void> = [];
  const llamadas = {
    create: [] as Array<{ id: number; url: string; active: boolean }>,
    remove: [] as number[],
    sendMessage: [] as Array<{ tabId: number; mensaje: unknown }>,
    update: [] as Array<{ tabId: number; props: unknown }>,
    windowsUpdate: [] as Array<{ windowId: number; props: unknown }>,
  };
  // `pestanasAbiertas` — qué devuelve chrome.tabs.query({}) en esta
  // prueba puntual; por default ninguna (así que "dato-pagina-
  // seguimiento" siempre toma el camino "se encola", nunca necesita
  // una pestaña de Seguimiento real abierta para probar el cierre).
  let pestanasAbiertas: Array<{ id: number; url: string; windowId?: number }> = [];
  // Issue #44 — respuesta que chrome.tabs.sendMessage le da a CADA
  // pestaña puntual (por tabId) — por default ninguna (como si no
  // tuviera marcador-zilonix.js cargado, el caso normal real).
  let respuestasSendMessage: Record<number, unknown> = {};

  const chrome = {
    runtime: {
      lastError: undefined as { message: string } | undefined,
      onMessage: {
        addListener: (fn: (mensaje: unknown, remitente: unknown, sendResponse?: (respuesta?: unknown) => void) => boolean | void) => {
          listeners.onMessage = fn;
        },
      },
      onStartup: {
        addListener: (fn: () => void) => {
          listeners.onStartup = fn;
        },
      },
    },
    // Issue #273 — chrome.action es el núcleo de Manifest V3 para el
    // ícono de la extensión, nunca un permiso nuevo en "permissions".
    action: {
      onClicked: {
        addListener: (fn: (tab: { id?: number }) => void) => {
          listeners.onClicked = fn;
        },
      },
    },
    storage: {
      session: {
        get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
          setTimeout(() => {
            const resultado: Record<string, unknown> = {};
            for (const key of Object.keys(defaults)) resultado[key] = key in storageSession ? storageSession[key] : defaults[key];
            cb(resultado);
          }, RETRASO_MOCK_MS);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          setTimeout(() => {
            Object.assign(storageSession, obj);
            cb?.();
          }, RETRASO_MOCK_MS);
        },
        // Issue #44 — "entregado una sola vez": el pendiente se borra
        // apenas se lee/entrega, real o vencido.
        remove: (clave: string, cb?: () => void) => {
          setTimeout(() => {
            delete storageSession[clave];
            cb?.();
          }, RETRASO_MOCK_MS);
        },
      },
      // Issue #44 — "zilonixUrlApp" (lo escribe marcador-zilonix.js,
      // chrome.storage.local, no session) — background.js lo lee acá
      // para "Importar a Publicar abre o enfoca Publicar". Síncrono a
      // propósito en el mock (a diferencia de session, arriba) — no
      // hace falta un retraso real para las pruebas de esto.
      local: {
        get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
          const resultado: Record<string, unknown> = {};
          for (const key of Object.keys(defaults)) resultado[key] = key in storageLocal ? storageLocal[key] : defaults[key];
          cb(resultado);
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
      // Issue #44 (anexo) — registro real de varios listeners (ver el
      // comentario de listenersOnUpdated más arriba), nunca un slot.
      onUpdated: {
        addListener: (fn: (tabId: number, cambioInfo: { status?: string }, tab: { id: number; url: string }) => void) => {
          listenersOnUpdated.push(fn);
        },
        removeListener: (fn: (tabId: number, cambioInfo: { status?: string }, tab: { id: number; url: string }) => void) => {
          const i = listenersOnUpdated.indexOf(fn);
          if (i !== -1) listenersOnUpdated.splice(i, 1);
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
      query: (_filtro: unknown, cb: (pestanas: Array<{ id: number; url: string; windowId?: number }>) => void) => {
        cb(pestanasAbiertas);
      },
      sendMessage: (tabId: number, mensaje: unknown, cb?: (respuesta?: unknown) => void) => {
        llamadas.sendMessage.push({ tabId, mensaje });
        setTimeout(() => cb?.(respuestasSendMessage[tabId]), RETRASO_MOCK_MS);
      },
      update: (tabId: number, props: unknown, cb?: () => void) => {
        llamadas.update.push({ tabId, props });
        cb?.();
      },
    },
    // Issue #44 — chrome.windows es núcleo de Manifest V3, nunca un
    // permiso nuevo (mismo criterio que chrome.action).
    windows: {
      update: (windowId: number, props: unknown, cb?: () => void) => {
        llamadas.windowsUpdate.push({ windowId, props });
        cb?.();
      },
    },
  };

  return {
    chrome,
    listeners,
    llamadas,
    // Issue #44 (anexo) — simula que una pestaña terminó de cargar (o
    // sigue redirigiendo) con esta URL — dispara TODOS los listeners
    // de onUpdated registrados en este momento, como el Chrome real.
    dispararTabActualizada: (tabId: number, url: string, status = "complete") => {
      for (const fn of [...listenersOnUpdated]) fn(tabId, { status }, { id: tabId, url });
    },
    cantidadListenersOnUpdated: () => listenersOnUpdated.length,
    setPestanasAbiertas: (pestanas: Array<{ id: number; url: string; windowId?: number }>) => {
      pestanasAbiertas = pestanas;
    },
    // Issue #44 — qué le contesta cada pestaña puntual (por id) a
    // chrome.tabs.sendMessage — simula el ack real de marcador-zilonix.js.
    setRespuestasSendMessage: (respuestas: Record<number, unknown>) => {
      respuestasSendMessage = respuestas;
    },
    setZilonixUrlApp: (url: string | null) => {
      if (url === null) delete storageLocal.zilonixUrlApp;
      else storageLocal.zilonixUrlApp = url;
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

// Issue #273 (Mateo) — "clic en el ícono de la extensión abre/muestra
// el panel en la pestaña actual, aunque el interruptor esté apagado".
// chrome.action.onClicked solo se dispara con un clic real de la
// persona (nunca algo que la extensión dispare sola) — background.js
// se limita a reenviar "zilonix:mostrar-panel" a esa MISMA pestaña;
// content.js (ver content.test.ts) es quien decide qué hacer con eso.
describe("chrome.action.onClicked — issue #273 (interruptor del panel)", () => {
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

  it("un clic manda zilonix:mostrar-panel a la MISMA pestaña que lo disparó", async () => {
    await cargarBackgroundFresco();
    mockActual.listeners.onClicked!({ id: 42 });
    expect(mockActual.llamadas.sendMessage).toEqual([{ tabId: 42, mensaje: { tipo: "zilonix:mostrar-panel" } }]);
  });

  it("sin tab.id (caso defensivo, Chrome siempre lo manda en la práctica) -> nunca manda nada, nunca revienta", async () => {
    await cargarBackgroundFresco();
    mockActual.listeners.onClicked!({});
    expect(mockActual.llamadas.sendMessage).toEqual([]);
  });
});

// Issue #44 (revisión de Pablo sobre el PR #290) — "Importar a
// Publicar": bug real que Mateo reportó — el botón solo mandaba el
// mensaje a una pestaña de /panel/publicar que YA estuviera abierta;
// sin ninguna, se perdía en silencio. "Seguir en Zilonix" sí abre su
// propia pestaña con el clic — background.js ahora hace lo mismo acá.
describe("zilonix:importar-publicar — issue #44 (abre o enfoca Publicar)", () => {
  let mockActual: ReturnType<typeof crearChromeMock>;
  const URL_PRODUCCION = "https://web-production-af270.up.railway.app";
  const URL_STAGING = "https://web-staging-d979.up.railway.app";
  const PAYLOAD = { titulo: "Cojín antiescaras", precio: 50_000, descripcion: null, imagenes: [] };

  beforeEach(() => {
    vi.useFakeTimers();
    mockActual = crearChromeMock();
    (globalThis as unknown as { chrome: unknown }).chrome = mockActual.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  async function mandarImportarPublicar(payload: unknown = PAYLOAD, remitenteTabId = 999) {
    const respuestas: unknown[] = [];
    mockActual.listeners.onMessage!({ tipo: "zilonix:importar-publicar", payload }, { tab: { id: remitenteTabId } }, (r) => respuestas.push(r));
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 10);
    return respuestas;
  }

  it("con una pestaña de Publicar YA abierta que acepta (ack publicar:true) -> la enfoca (pestaña y ventana), nunca abre otra", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([{ id: 7, url: `${URL_PRODUCCION}/panel/publicar`, windowId: 3 }]);
    mockActual.setRespuestasSendMessage({ 7: { ok: true, publicar: true } });

    const respuestas = await mandarImportarPublicar();

    expect(mockActual.llamadas.create).toEqual([]); // nunca abre una segunda pestaña
    expect(mockActual.llamadas.update).toEqual([{ tabId: 7, props: { active: true } }]);
    expect(mockActual.llamadas.windowsUpdate).toEqual([{ windowId: 3, props: { focused: true } }]);
    expect(respuestas).toEqual([{ ok: true, abrioNueva: false }]);
  });

  it("sin ninguna pestaña de Publicar abierta -> crea una pestaña nueva con la URL de PRODUCCIÓN por default", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([]);

    const respuestas = await mandarImportarPublicar();

    expect(mockActual.llamadas.create).toEqual([{ id: 100, url: `${URL_PRODUCCION}/panel/publicar`, active: true }]);
    expect(mockActual.llamadas.update).toEqual([]);
    expect(respuestas).toEqual([{ ok: true, abrioNueva: true }]);
  });

  it("con zilonixUrlApp en STAGING guardado -> la pestaña nueva abre en staging, no producción", async () => {
    await cargarBackgroundFresco();
    mockActual.setZilonixUrlApp(URL_STAGING);
    mockActual.setPestanasAbiertas([]);

    await mandarImportarPublicar();

    expect(mockActual.llamadas.create).toEqual([{ id: 100, url: `${URL_STAGING}/panel/publicar`, active: true }]);
  });

  it("con zilonixUrlApp guardado pero FUERA de la allowlist -> cae a producción, nunca abre un origin ajeno", async () => {
    await cargarBackgroundFresco();
    mockActual.setZilonixUrlApp("https://evil.com");
    mockActual.setPestanasAbiertas([]);

    await mandarImportarPublicar();

    expect(mockActual.llamadas.create).toEqual([{ id: 100, url: `${URL_PRODUCCION}/panel/publicar`, active: true }]);
  });

  // Pestañas de Seller que NO son Publicar (ej. /panel/investigacion)
  // contestan {ok:true, publicar:false} (marcador-zilonix.js corregido
  // en esta misma revisión) — background.js nunca las confunde con una
  // pestaña real de Publicar.
  it("con una pestaña de Seller que NO es Publicar (ack publicar:false) -> la ignora, abre una pestaña nueva igual", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([{ id: 8, url: `${URL_PRODUCCION}/panel/investigacion`, windowId: 3 }]);
    mockActual.setRespuestasSendMessage({ 8: { ok: true, publicar: false } });

    const respuestas = await mandarImportarPublicar();

    expect(mockActual.llamadas.update).toEqual([]);
    expect(mockActual.llamadas.create).toEqual([{ id: 100, url: `${URL_PRODUCCION}/panel/publicar`, active: true }]);
    expect(respuestas).toEqual([{ ok: true, abrioNueva: true }]);
  });

  // Doble clic real en 3s: la segunda llamada no tiene que abrir ni
  // enfocar nada — mismo criterio que el cooldown de "Actualizar todo".
  it("doble clic en menos de 3s -> solo se abre UNA pestaña", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([]);

    await mandarImportarPublicar(PAYLOAD, 1);
    await mandarImportarPublicar(PAYLOAD, 1);

    expect(mockActual.llamadas.create.length).toBe(1);
  });

  it("un segundo clic DESPUÉS de los 3s de cooldown SÍ abre otra pestaña", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([]);

    await mandarImportarPublicar(PAYLOAD, 1);
    await vi.advanceTimersByTimeAsync(3_000 + 100);
    await mandarImportarPublicar(PAYLOAD, 1);

    expect(mockActual.llamadas.create.length).toBe(2);
  });

  // Issue #44 — "zilonix:pedir-importacion-pendiente" es lo que
  // /panel/publicar pide apenas su listener está montado (ver
  // marcador-zilonix.test.ts, "publicar-listo").
  async function pedirImportacionPendiente() {
    const respuestas: unknown[] = [];
    mockActual.listeners.onMessage!({ tipo: "zilonix:pedir-importacion-pendiente" }, { tab: { id: 7 } }, (r) => respuestas.push(r));
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);
    return respuestas;
  }

  it("el pendiente se entrega UNA sola vez: la segunda vez que se pide, ya no hay nada", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([]); // nadie acepta en vivo -> queda guardado como pendiente
    await mandarImportarPublicar();

    const primera = await pedirImportacionPendiente();
    expect(primera).toEqual([{ payload: PAYLOAD }]);

    const segunda = await pedirImportacionPendiente();
    expect(segunda).toEqual([{ payload: null }]);
  });

  it("el pendiente caduca a los 2 minutos — pasado ese tiempo, se entrega null (y se borra igual)", async () => {
    await cargarBackgroundFresco();
    mockActual.setPestanasAbiertas([]);
    await mandarImportarPublicar();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1_000);
    const respuesta = await pedirImportacionPendiente();
    expect(respuesta).toEqual([{ payload: null }]);
  });

  it("sin nada pendiente todavía -> se entrega null, nunca revienta", async () => {
    await cargarBackgroundFresco();
    const respuesta = await pedirImportacionPendiente();
    expect(respuesta).toEqual([{ payload: null }]);
  });
});

// Issue #44/#273 (anexo, pedido de Pablo tras el PR #290) — "Traer
// datos de ese link": con cualquier link de Mercado Libre (publicación
// normal, catálogo /p/, /up/, o un link corto meli.la), la extensión
// abre esa publicación en una pestaña de fondo, la lee, la cierra, y
// manda el resultado de vuelta SOLO a la pestaña que lo pidió — con el
// mismo mensaje "zilonix:importar-publicar" que ya usa "Importar a
// Publicar". background.js es la última línea real de defensa: vuelve
// a validar el dominio del link (nunca confía en SeccionesImportar.tsx)
// y, después de que meli.la redirige, vuelve a validar la URL FINAL
// antes de pedirle a content.js que lea nada.
describe('zilonix:importar-link — anexo "Traer datos de ese link" (issue #44/#273)', () => {
  let mockActual: ReturnType<typeof crearChromeMock>;
  const LINK_NORMAL = "https://articulo.mercadolibre.com.co/MCO-123456-cojin-antiescaras-_JM";
  const LINK_CATALOGO = "https://www.mercadolibre.com.co/p/MCO12345678";
  const LINK_UP = "https://www.mercadolibre.com.co/up/MCOU987654321?quantity=6";
  const LINK_CORTO = "https://meli.la/abc123XYZ";
  const PAYLOAD_IMPORTADO = { titulo: "Cojín antiescaras", descripcion: "Descripción", precio: 50_000, imagenes: [] };

  beforeEach(() => {
    vi.useFakeTimers();
    mockActual = crearChromeMock();
    (globalThis as unknown as { chrome: unknown }).chrome = mockActual.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  async function mandarImportarLink(link: unknown, tabIdSolicitante = 1) {
    mockActual.listeners.onMessage!({ tipo: "zilonix:importar-link", payload: { link } }, { tab: { id: tabIdSolicitante } });
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);
  }

  async function mandarResultadoLectura(tabIdLectura: number, payload: unknown) {
    mockActual.listeners.onMessage!({ tipo: "zilonix:resultado-leer-para-importar", payload }, { tab: { id: tabIdLectura } });
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);
  }

  function erroresA(tabIdSolicitante: number) {
    return mockActual.llamadas.sendMessage.filter(
      (m) => m.tabId === tabIdSolicitante && (m.mensaje as { tipo?: string }).tipo === "zilonix:importar-link-error"
    ) as Array<{ tabId: number; mensaje: { tipo: string; payload: { razon: string } } }>;
  }

  it("rechaza dominios con spoofing real (mercadolibre.com.co.evil.com, evilmercadolibre.com, etc.) — nunca abre ninguna pestaña", async () => {
    await cargarBackgroundFresco();
    for (const linkMalo of [
      "https://mercadolibre.com.co.evil.com/MCO-123",
      "https://evilmercadolibre.com/MCO-123",
      "https://notmercadolibre.com/MCO-123",
      "http://articulo.mercadolibre.com.co/MCO-123", // http, no https
      "",
    ]) {
      await mandarImportarLink(linkMalo, 1);
    }
    expect(mockActual.llamadas.create).toEqual([]);
    expect(erroresA(1).length).toBe(5);
    expect(erroresA(1).every((e) => e.mensaje.payload.razon === "dominio_no_permitido")).toBe(true);
  });

  it("acepta los 4 tipos de link reales: publicación normal, catálogo /p/, /up/ y el link corto meli.la — siempre en una pestaña de fondo", async () => {
    await cargarBackgroundFresco();
    for (const linkBueno of [LINK_NORMAL, LINK_CATALOGO, LINK_UP, LINK_CORTO]) {
      await mandarImportarLink(linkBueno, 1);
      await vi.advanceTimersByTimeAsync(COOLDOWN_IMPORTAR_LINK_MS + 100); // separa cada uno del cooldown global
    }
    expect(mockActual.llamadas.create.map((t) => t.url)).toEqual([LINK_NORMAL, LINK_CATALOGO, LINK_UP, LINK_CORTO]);
    expect(mockActual.llamadas.create.every((t) => t.active === false)).toBe(true); // nunca roba el foco
  });

  it("meli.la: espera la URL FINAL después del redirect antes de pedir la lectura — nunca lee mientras sigue en meli.la", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_CORTO, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;

    mockActual.dispararTabActualizada(tabIdLectura, "https://meli.la/paso-intermedio-del-redirect", "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);
    expect(mockActual.llamadas.sendMessage.find((m) => (m.mensaje as { tipo?: string }).tipo === "zilonix:leer-para-importar")).toBeUndefined();

    mockActual.dispararTabActualizada(tabIdLectura, LINK_NORMAL, "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);
    expect(mockActual.llamadas.sendMessage).toContainEqual({ tabId: tabIdLectura, mensaje: { tipo: "zilonix:leer-para-importar" } });
  });

  it("si meli.la termina en un dominio que NO es Mercado Libre, cierra la pestaña y avisa — nunca intenta leerla", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_CORTO, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;

    mockActual.dispararTabActualizada(tabIdLectura, "https://evil.com/phishing", "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    expect(mockActual.llamadas.remove).toContain(tabIdLectura);
    expect(erroresA(1).some((e) => e.mensaje.payload.razon === "no_es_mercadolibre")).toBe(true);
    expect(mockActual.llamadas.sendMessage.find((m) => (m.mensaje as { tipo?: string }).tipo === "zilonix:leer-para-importar")).toBeUndefined();
    expect(mockActual.cantidadListenersOnUpdated()).toBe(0);
  });

  it("cooldown de 5s GLOBAL: un segundo link casi al mismo tiempo (aunque sea desde otra pestaña) no abre otra lectura", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    await mandarImportarLink(LINK_CATALOGO, 2); // otra pestaña solicitante -- el cooldown es global, no por pestaña

    expect(mockActual.llamadas.create.length).toBe(1);
  });

  it("pasado el cooldown de 5s, un link nuevo SÍ abre otra lectura", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    await vi.advanceTimersByTimeAsync(COOLDOWN_IMPORTAR_LINK_MS + 100);
    await mandarImportarLink(LINK_CATALOGO, 1);

    expect(mockActual.llamadas.create.length).toBe(2);
  });

  it("una segunda lectura de la MISMA pestaña solicitante reemplaza a la anterior: cierra la pestaña de lectura vieja, nunca deja 2 a la vez", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLecturaVieja = mockActual.llamadas.create[0].id;
    await vi.advanceTimersByTimeAsync(COOLDOWN_IMPORTAR_LINK_MS + 100);
    await mandarImportarLink(LINK_CATALOGO, 1);

    expect(mockActual.llamadas.remove).toContain(tabIdLecturaVieja);
    expect(mockActual.llamadas.create.length).toBe(2);
    expect(mockActual.cantidadListenersOnUpdated()).toBe(1); // solo el listener de la lectura nueva queda vivo
  });

  it("tope de 30s: si nunca llega el 'complete' final, cierra la pestaña y avisa 'timeout' — nunca reintenta sola", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;

    await vi.advanceTimersByTimeAsync(TIEMPO_MAX_IMPORTAR_LINK_MS + 1_000);

    expect(mockActual.llamadas.remove).toContain(tabIdLectura);
    expect(erroresA(1).some((e) => e.mensaje.payload.razon === "timeout")).toBe(true);
    expect(mockActual.cantidadListenersOnUpdated()).toBe(0);
    expect(mockActual.llamadas.create.length).toBe(1); // nunca abre otra sola
  });

  it("el resultado se manda SOLO a la pestaña que lo pidió, nunca a otra pestaña solicitante con una lectura paralela", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura1 = mockActual.llamadas.create[0].id;
    await vi.advanceTimersByTimeAsync(COOLDOWN_IMPORTAR_LINK_MS + 100);
    await mandarImportarLink(LINK_CATALOGO, 2);
    const tabIdLectura2 = mockActual.llamadas.create[1].id;

    mockActual.dispararTabActualizada(tabIdLectura1, LINK_NORMAL, "complete");
    mockActual.dispararTabActualizada(tabIdLectura2, LINK_CATALOGO, "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);

    await mandarResultadoLectura(tabIdLectura1, { datos: PAYLOAD_IMPORTADO });

    const mandadosATab2 = mockActual.llamadas.sendMessage.filter((m) => m.tabId === 2);
    expect(mandadosATab2).toEqual([]); // la pestaña 2 (solicitante del otro link) nunca recibe este resultado
    expect(mockActual.llamadas.sendMessage).toContainEqual({ tabId: 1, mensaje: { tipo: "zilonix:importar-publicar", payload: PAYLOAD_IMPORTADO } });
  });

  it("captcha detectado en la pestaña de lectura: cierra la pestaña, avisa 'captcha', y nunca reintenta sola", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;
    mockActual.dispararTabActualizada(tabIdLectura, LINK_NORMAL, "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);

    await mandarResultadoLectura(tabIdLectura, { captcha: true });

    expect(mockActual.llamadas.remove).toContain(tabIdLectura);
    expect(erroresA(1).some((e) => e.mensaje.payload.razon === "captcha")).toBe(true);

    await vi.advanceTimersByTimeAsync(TIEMPO_MAX_IMPORTAR_LINK_MS + 1_000);
    expect(mockActual.llamadas.create.length).toBe(1); // nunca vuelve a intentar sola
  });

  it("sin datos ni captcha (lectura vacía) -> avisa 'vacio' y cierra la pestaña", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;
    mockActual.dispararTabActualizada(tabIdLectura, LINK_NORMAL, "complete");
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);

    await mandarResultadoLectura(tabIdLectura, {});

    expect(mockActual.llamadas.remove).toContain(tabIdLectura);
    expect(erroresA(1).some((e) => e.mensaje.payload.razon === "vacio")).toBe(true);
  });

  it("un 'resultado-leer-para-importar' de una pestaña sin ninguna lectura activa se ignora, nunca rompe nada", async () => {
    await cargarBackgroundFresco();
    await mandarResultadoLectura(999, { datos: PAYLOAD_IMPORTADO });
    expect(mockActual.llamadas.sendMessage).toEqual([]);
  });

  it("si la persona cierra a mano la pestaña de LECTURA, se cancela la lectura sin dejar timeout/listener huérfano, y no manda ningún error", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;

    mockActual.listeners.onRemoved!(tabIdLectura);
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);

    expect(mockActual.cantidadListenersOnUpdated()).toBe(0);
    expect(erroresA(1)).toEqual([]); // cancelar (a diferencia de terminar) nunca manda un mensaje a la solicitante

    await vi.advanceTimersByTimeAsync(TIEMPO_MAX_IMPORTAR_LINK_MS + 1_000);
    expect(erroresA(1)).toEqual([]); // el timeout ya se canceló, nunca dispara igual
  });

  it("si la persona cierra a mano la pestaña SOLICITANTE (la de Publicar), se cancela la lectura y se cierra su pestaña de lectura", async () => {
    await cargarBackgroundFresco();
    await mandarImportarLink(LINK_NORMAL, 1);
    const tabIdLectura = mockActual.llamadas.create[0].id;

    mockActual.listeners.onRemoved!(1);
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 2);

    expect(mockActual.llamadas.remove).toContain(tabIdLectura);
    expect(mockActual.cantidadListenersOnUpdated()).toBe(0);
  });

  it("si chrome.tabs.create falla (lastError) -> avisa 'no_se_pudo_abrir', nunca revienta", async () => {
    await cargarBackgroundFresco();
    mockActual.chrome.runtime.lastError = { message: "No se pudo abrir la pestaña" };
    await mandarImportarLink(LINK_NORMAL, 1);

    expect(erroresA(1).some((e) => e.mensaje.payload.razon === "no_se_pudo_abrir")).toBe(true);
  });

  it("sin remitente.tab.id (caso defensivo) -> no hace nada, nunca revienta", async () => {
    await cargarBackgroundFresco();
    mockActual.listeners.onMessage!({ tipo: "zilonix:importar-link", payload: { link: LINK_NORMAL } }, {});
    await vi.advanceTimersByTimeAsync(RETRASO_MOCK_MS * 4);

    expect(mockActual.llamadas.create).toEqual([]);
  });
});
