import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #251 (fix "aproximados siempre visibles") — content.js es un
// content script clásico (IIFE sin "type": "module" en manifest.json,
// igual que background.js — ver background.test.ts) que lee
// window.ZilonixUtilidades/ZilonixSeguridad/ZilonixLectorActivo/
// ZilonixAproximados/ZilonixCalibracion y arranca solo al cargar
// (reescanear() + MutationObserver + setInterval, todos sin exponer
// nada). Para poder probar bloqueAnalisisAproximado (la función pura
// detrás del bloque "Análisis aprox." del popup) sin un navegador
// real, content.js exporta esa función con el mismo patrón dual
// module.exports/window.X que ya usan extension/utilidades.js,
// extension/seguridad.js y extension/lectores/aproximados.js — nunca
// se exporta nada que dependa de document/chrome real.
//
// `lector.tipoDePagina` se mockea devolviendo `null`: así reescanear()
// (que SÍ corre apenas se importa el archivo) nunca llega a tocar
// document/chrome de verdad — alcanza con los stubs mínimos de abajo
// (document.body, MutationObserver, location.href) para que el import
// no reviente, sin necesitar jsdom.
const CALIBRACION_PRUEBA = { factorVendidosFull: 2.2, factorVendidosSinFull: 1.55, puntos: [] };

async function cargarContentFresco() {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { location: { href: string } }).location = { href: "https://articulo.mercadolibre.com.co/MCO-123456789-reloj" };
  (globalThis as unknown as { document: { body: unknown } }).document = { body: {} };
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe() {
      // nunca se dispara en esta prueba — reescanear() ya volvió antes de llegar acá
    }
  };
  (globalThis as unknown as { chrome: unknown }).chrome = undefined;
  (globalThis as unknown as Record<string, unknown>).ZilonixUtilidades = {};
  // Issue #174 — mismo patrón dual que seguridad.test.ts: se importa
  // el módulo real (no un mock) para que textoCampo() escape de
  // verdad, igual que en producción.
  const seguridad = await import("./seguridad.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixSeguridad = seguridad;
  (globalThis as unknown as Record<string, unknown>).ZilonixLectorActivo = {
    sitio: "Mercado Libre Colombia",
    tipoDePagina: () => null, // reescanear() corta ahí mismo — nunca llega a leer document de verdad
  };
  const aproximados = await import("./lectores/aproximados.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixAproximados = aproximados;
  (globalThis as unknown as Record<string, unknown>).ZilonixCalibracion = CALIBRACION_PRUEBA;

  return (await import("./content.js")) as unknown as {
    bloqueAnalisisAproximado: (datos: Record<string, unknown>) => string;
    valorInterruptorDesdeStorage: (valorGuardado: unknown) => boolean;
    debeDibujarPanel: (interruptorEncendido: boolean, panelCerrado: boolean) => boolean;
    leerPanelCerrado: (storage: StorageFake | null) => boolean;
    escribirPanelCerrado: (storage: StorageFake | null, cerrado: boolean) => void;
    leerPanelMinimizado: (storage: StorageFake | null) => boolean;
    escribirPanelMinimizado: (storage: StorageFake | null, minimizado: boolean) => void;
    esMensajeDePropiaExtension: (remitente: { id?: string } | null | undefined, idPropio: string) => boolean;
    etiquetaAmbienteDeUrlApp: (urlApp: unknown) => string;
  };
}

// Issue #273 — fake mínimo de sessionStorage ({getItem,setItem,removeItem}),
// nunca el sessionStorage real del navegador (este proyecto no tiene
// jsdom) — mismo criterio que el resto de este archivo: funciones
// puras, probadas con un storage-fake en memoria.
type StorageFake = { getItem: (clave: string) => string | null; setItem: (clave: string, valor: string) => void; removeItem: (clave: string) => void };
function storageFake(): StorageFake {
  const datos: Record<string, string> = {};
  return {
    getItem: (clave) => (clave in datos ? datos[clave] : null),
    setItem: (clave, valor) => {
      datos[clave] = valor;
    },
    removeItem: (clave) => {
      delete datos[clave];
    },
  };
}

describe("content.js — bloqueAnalisisAproximado, issue #251 (fix 'aproximados siempre visibles')", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin vendidos (0 o no visible en ML): el bloque SIEMPRE se renderiza, nunca \"\" — 'Vendidos estimados' explica por qué falta", async () => {
    const mod = await cargarContentFresco();
    const html = mod.bloqueAnalisisAproximado({ vendidos: null, vendidosExacto: false, esFull: null, precio: 100_000, moneda: "COP", dateCreated: null, itemId: "MCO123456789" });
    expect(html).not.toBe("");
    expect(html).toContain("Análisis aprox.");
    expect(html).toContain("Vendidos estimados");
    expect(html).toContain("Sin dato (0 o no visible en ML)");
    // El resto de las filas también caen a "Sin dato", nunca quedan
    // vacías ni con un número inventado.
    expect(html).toContain("Antigüedad");
    expect(html).toContain("Ventas/mes");
    expect(html).toContain("Facturación/mes");
  });

  it("con vendidos (el piso '+N' de la ficha): sigue mostrando el estimado real, sin regresión", async () => {
    const mod = await cargarContentFresco();
    const html = mod.bloqueAnalisisAproximado({ vendidos: 100, vendidosExacto: false, esFull: true, precio: 79_900, moneda: "COP", dateCreated: null, itemId: "MCO64541261" });
    expect(html).not.toBe("");
    expect(html).toContain("220"); // 100 × 2.2 (Full), redondeado
  });
});

// Issue #273 (Mateo) — "el panel aparece siempre, y si lo minimizo o
// lo cierro vuelve enseguida". Las 2 funciones puras de abajo son el
// corazón del arreglo: valorInterruptorDesdeStorage decide el estado
// real del interruptor global (chrome.storage.local) y debeDibujarPanel
// decide si reescanear() (MutationObserver + setInterval, el mecanismo
// que antes volvía a inyectar el panel solo) tiene permiso para
// DIBUJAR el panel — sin DOM ni chrome real, un storage-fake alcanza.
// Issue #273 (revisión de Pablo, punto 1 — HIGH): renombrada de
// debeReescanearAuto a debeDibujarPanel — ya NO decide si reescanear()
// corre entero, solo si la parte de DIBUJO corre. La lectura de la
// página y los envíos silenciosos (enviarVendidosAZilonix, etc.) corren
// siempre que haya un `tipo` de página reconocido, sin importar esto
// — ver la descripción completa del bug real en reescanear() (content.js).
describe("valorInterruptorDesdeStorage — issue #273 (interruptor global)", () => {
  it("sin nada guardado todavía (undefined, primera vez que se usa esta versión) -> true (comportamiento de siempre)", async () => {
    const mod = await cargarContentFresco();
    expect(mod.valorInterruptorDesdeStorage(undefined)).toBe(true);
  });

  it("guardado explícito true -> true", async () => {
    const mod = await cargarContentFresco();
    expect(mod.valorInterruptorDesdeStorage(true)).toBe(true);
  });

  it("guardado explícito false (apagado) -> false", async () => {
    const mod = await cargarContentFresco();
    expect(mod.valorInterruptorDesdeStorage(false)).toBe(false);
  });
});

describe("debeDibujarPanel — issue #273 (nunca reinyecta/dibuja el panel solo)", () => {
  it("interruptor encendido y panel NO cerrado en esta pestaña -> true, se dibuja normal", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeDibujarPanel(true, false)).toBe(true);
  });

  it("interruptor APAGADO (aunque el panel no esté cerrado en esta pestaña) -> false, nunca dibuja", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeDibujarPanel(false, false)).toBe(false);
  });

  // Caso real del bug: la persona cerró el panel con la X en esta
  // pestaña, el interruptor global sigue encendido — antes de esta
  // tarea, el próximo tick del MutationObserver/intervalo lo volvía a
  // dibujar solo. Ahora corta acá, nunca llega a tocar el DOM.
  it("panel cerrado en esta pestaña (aunque el interruptor siga encendido) -> false, nunca se redibuja solo", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeDibujarPanel(true, true)).toBe(false);
  });

  it("interruptor apagado Y panel cerrado -> false", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeDibujarPanel(false, true)).toBe(false);
  });
});

// Issue #273 (revisión de Pablo, punto 1 — HIGH) — prueba de
// integración real de reescanear(): las 4 combinaciones interruptor
// ON/OFF × cerrado sí/no, confirmando AL MISMO TIEMPO que (a) el panel
// se dibuja SOLO cuando corresponde (document.createElement/getElementById
// nunca se llaman si no toca dibujar) y (b) el envío silencioso
// (chrome.runtime.sendMessage, "Completar vendidos" + el relevo de
// Seguimiento) corre SIEMPRE que haya datos, en las 4 combinaciones —
// el bug real que encontró Pablo: antes de esta corrección, con el
// interruptor apagado o la pestaña cerrada, reescanear() cortaba TODO
// antes de leer la página, así que estos 2 envíos nunca llegaban.
//
// chrome.runtime.getURL/document.createElement devuelven objetos
// mínimos (nunca un DOM real — este proyecto no tiene jsdom): alcanza
// para que obtenerOCrearPanel() no reviente; cualquier fallo DENTRO de
// renderizarProducto (querySelector devolviendo null, nunca falla acá
// a propósito) queda contenido por su propio try/catch (content.js) —
// nunca puede tirarse abajo los envíos que vienen después en el mismo
// bloque, que es justo lo que esta prueba verifica.
function crearChromeMockParaReescanear(interruptorEncendido: boolean) {
  const mensajesEnviados: Array<{ tipo: string; payload: unknown }> = [];
  const chrome = {
    runtime: {
      id: "zilonix-test-id",
      lastError: undefined as { message: string } | undefined,
      getURL: (ruta: string) => `chrome-extension://zilonix-test-id/${ruta}`,
      onMessage: { addListener: () => {} },
      sendMessage: (mensaje: { tipo: string; payload: unknown }, cb?: () => void) => {
        mensajesEnviados.push(mensaje);
        cb?.();
      },
    },
    storage: {
      local: {
        get: (_defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
          cb({ zilonixInterruptorEncendido: interruptorEncendido });
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
  return { chrome, mensajesEnviados };
}

function crearDocumentoFakeParaReescanear() {
  const llamadas = { createElement: 0, getElementById: 0 };
  const elementoFake = () => ({
    id: "",
    className: "",
    rel: "",
    href: "",
    innerHTML: "",
    attachShadow: () => ({ appendChild: () => {} }),
    appendChild: () => {},
    querySelector: () => null, // nunca encuentra nada -- cablearEncabezado revienta ahí, contenido por el try/catch nuevo de reescanear()
  });
  const documento = {
    body: {},
    getElementById: () => {
      llamadas.getElementById++;
      return null;
    },
    createElement: () => {
      llamadas.createElement++;
      return elementoFake();
    },
    documentElement: { appendChild: () => {} },
  };
  return { documento, llamadas };
}

function crearSessionStorageFakeParaReescanear(cerrado: boolean) {
  const datos: Record<string, string> = {};
  if (cerrado) datos["zilonix-panel-cerrado-174"] = "1";
  return {
    getItem: (clave: string) => (clave in datos ? datos[clave] : null),
    setItem: (clave: string, valor: string) => {
      datos[clave] = valor;
    },
    removeItem: (clave: string) => {
      delete datos[clave];
    },
  };
}

async function cargarContentParaPaginaProducto(interruptorEncendido: boolean, cerrado: boolean) {
  vi.resetModules();
  const { documento, llamadas } = crearDocumentoFakeParaReescanear();
  const { chrome, mensajesEnviados } = crearChromeMockParaReescanear(interruptorEncendido);
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { location: { href: string } }).location = { href: "https://articulo.mercadolibre.com.co/MCO-123456789-reloj" };
  (globalThis as unknown as { document: unknown }).document = documento;
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = crearSessionStorageFakeParaReescanear(cerrado);
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe() {
      // nunca se dispara en esta prueba — sin mutaciones reales del DOM fake
    }
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chrome;
  (globalThis as unknown as Record<string, unknown>).ZilonixUtilidades = {};
  const seguridad = await import("./seguridad.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixSeguridad = seguridad;
  (globalThis as unknown as Record<string, unknown>).ZilonixLectorActivo = {
    sitio: "Mercado Libre Colombia",
    tipoDePagina: () => "producto",
    leerProducto: () => ({
      titulo: "Reloj",
      precio: 50_000,
      moneda: "COP",
      vendidos: 5,
      vendidosExacto: true,
      esFull: false,
      dateCreated: null,
      itemId: "MCO123456789",
      inventarioMaximo: null,
      inventarioMaximoAproximado: false,
    }),
  };
  const aproximados = await import("./lectores/aproximados.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixAproximados = aproximados;
  (globalThis as unknown as Record<string, unknown>).ZilonixCalibracion = CALIBRACION_PRUEBA;

  await import("./content.js");
  return { llamadasDom: llamadas, mensajesEnviados };
}

describe("reescanear() — issue #273 (revisión de Pablo, punto 1 — HIGH): dibujo vs. envío, las 4 combinaciones", () => {
  // El fake de document.querySelector (arriba) siempre devuelve null a
  // propósito — cablearEncabezado revienta ahí adentro (esperado, el
  // DOM fake no implementa querySelector de verdad), contenido por el
  // try/catch nuevo de reescanear(). console.warn se silencia acá
  // porque es ruido esperado de ESTA prueba puntual, nunca un error
  // real: lo que valida cada `it` es justo que ese fallo NUNCA bloquee
  // los envíos de abajo.
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
    consoleWarnSpy.mockRestore();
  });

  it("interruptor ON, pestaña NO cerrada -> dibuja el panel Y envía los 2 mensajes silenciosos", async () => {
    const { llamadasDom, mensajesEnviados } = await cargarContentParaPaginaProducto(true, false);
    expect(llamadasDom.createElement).toBeGreaterThan(0); // intentó dibujar
    const tipos = mensajesEnviados.map((m) => m.tipo);
    expect(tipos).toContain("zilonix:vendidos"); // "Completar vendidos"
    expect(tipos).toContain("zilonix:dato-pagina-seguimiento"); // relevo de Seguimiento
  });

  it("interruptor APAGADO, pestaña no cerrada -> NUNCA dibuja, pero los 2 envíos silenciosos SÍ corren (bug real de Pablo)", async () => {
    const { llamadasDom, mensajesEnviados } = await cargarContentParaPaginaProducto(false, false);
    expect(llamadasDom.createElement).toBe(0);
    expect(llamadasDom.getElementById).toBe(0);
    const tipos = mensajesEnviados.map((m) => m.tipo);
    expect(tipos).toContain("zilonix:vendidos");
    expect(tipos).toContain("zilonix:dato-pagina-seguimiento");
  });

  it("interruptor ON, pestaña CERRADA con la X -> NUNCA dibuja, pero los 2 envíos silenciosos SÍ corren", async () => {
    const { llamadasDom, mensajesEnviados } = await cargarContentParaPaginaProducto(true, true);
    expect(llamadasDom.createElement).toBe(0);
    expect(llamadasDom.getElementById).toBe(0);
    const tipos = mensajesEnviados.map((m) => m.tipo);
    expect(tipos).toContain("zilonix:vendidos");
    expect(tipos).toContain("zilonix:dato-pagina-seguimiento");
  });

  it("interruptor APAGADO Y pestaña cerrada -> NUNCA dibuja, pero los 2 envíos silenciosos SÍ corren", async () => {
    const { llamadasDom, mensajesEnviados } = await cargarContentParaPaginaProducto(false, true);
    expect(llamadasDom.createElement).toBe(0);
    expect(llamadasDom.getElementById).toBe(0);
    const tipos = mensajesEnviados.map((m) => m.tipo);
    expect(tipos).toContain("zilonix:vendidos");
    expect(tipos).toContain("zilonix:dato-pagina-seguimiento");
  });
});

describe("esMensajeDePropiaExtension — issue #273 (revisión de Pablo, punto 4 — LOW)", () => {
  it("remitente.id igual al id de esta extensión -> true", async () => {
    const mod = await cargarContentFresco();
    expect(mod.esMensajeDePropiaExtension({ id: "zilonix-id-real" }, "zilonix-id-real")).toBe(true);
  });

  it("remitente.id de OTRA extensión -> false, nunca se confía solo en el tipo del mensaje", async () => {
    const mod = await cargarContentFresco();
    expect(mod.esMensajeDePropiaExtension({ id: "otra-extension-cualquiera" }, "zilonix-id-real")).toBe(false);
  });

  it("sin remitente (undefined/null) -> false, nunca revienta", async () => {
    const mod = await cargarContentFresco();
    expect(mod.esMensajeDePropiaExtension(undefined, "zilonix-id-real")).toBe(false);
    expect(mod.esMensajeDePropiaExtension(null, "zilonix-id-real")).toBe(false);
  });
});

describe("etiquetaAmbienteDeUrlApp — issue #273 (revisión de Pablo, punto 2: 'Enviando a: Staging/Producción')", () => {
  it("una URL con 'staging' en el host -> \"Staging\"", async () => {
    const mod = await cargarContentFresco();
    expect(mod.etiquetaAmbienteDeUrlApp("https://web-staging-d979.up.railway.app")).toBe("Staging");
  });

  it("la URL real de producción -> \"Producción\"", async () => {
    const mod = await cargarContentFresco();
    expect(mod.etiquetaAmbienteDeUrlApp("https://web-production-af270.up.railway.app")).toBe("Producción");
  });

  it("sin dato (nunca debería pasar — config.js siempre da un string) -> \"Producción\", nunca revienta", async () => {
    const mod = await cargarContentFresco();
    expect(mod.etiquetaAmbienteDeUrlApp(undefined)).toBe("Producción");
    expect(mod.etiquetaAmbienteDeUrlApp(null)).toBe("Producción");
  });
});

describe("leerPanelCerrado / escribirPanelCerrado — issue #273 (cerrado por pestaña)", () => {
  it("storage fresco (nunca se cerró en esta pestaña) -> false", async () => {
    const mod = await cargarContentFresco();
    expect(mod.leerPanelCerrado(storageFake())).toBe(false);
  });

  it("escribir cerrado=true, después leerlo -> true (lo que hace el botón X)", async () => {
    const mod = await cargarContentFresco();
    const storage = storageFake();
    mod.escribirPanelCerrado(storage, true);
    expect(mod.leerPanelCerrado(storage)).toBe(true);
  });

  it("escribir cerrado=false (lo que hace mostrarPanelPorIcono) limpia el estado anterior", async () => {
    const mod = await cargarContentFresco();
    const storage = storageFake();
    mod.escribirPanelCerrado(storage, true);
    mod.escribirPanelCerrado(storage, false);
    expect(mod.leerPanelCerrado(storage)).toBe(false);
  });

  it("sin storage disponible (null — ej. sessionStorage bloqueado) -> leer da false, escribir nunca revienta", async () => {
    const mod = await cargarContentFresco();
    expect(mod.leerPanelCerrado(null)).toBe(false);
    expect(() => mod.escribirPanelCerrado(null, true)).not.toThrow();
  });
});

describe("leerPanelMinimizado / escribirPanelMinimizado — issue #273 (minimizado sobrevive a reescanear())", () => {
  it("storage fresco (nunca se minimizó en esta pestaña) -> false", async () => {
    const mod = await cargarContentFresco();
    expect(mod.leerPanelMinimizado(storageFake())).toBe(false);
  });

  // Caso real del bug: renderizarEsqueleto reconstruye panel.innerHTML
  // ENTERO en cada reescanear() — sin esta persistencia, el "hidden"
  // que puso el clic de colapsar se perdía con la próxima mutación del
  // DOM (casi inmediata en una página ML viva).
  it("escribir minimizado=true sobrevive, simulando varias llamadas de reescanear() seguidas", async () => {
    const mod = await cargarContentFresco();
    const storage = storageFake();
    mod.escribirPanelMinimizado(storage, true);
    // 3 "reescaneos" seguidos (cada uno solo LEE, nunca reescribe el
    // estado minimizado por su cuenta) -> sigue minimizado los 3.
    expect(mod.leerPanelMinimizado(storage)).toBe(true);
    expect(mod.leerPanelMinimizado(storage)).toBe(true);
    expect(mod.leerPanelMinimizado(storage)).toBe(true);
  });

  it("escribir minimizado=false (expandir de nuevo) limpia el estado", async () => {
    const mod = await cargarContentFresco();
    const storage = storageFake();
    mod.escribirPanelMinimizado(storage, true);
    mod.escribirPanelMinimizado(storage, false);
    expect(mod.leerPanelMinimizado(storage)).toBe(false);
  });

  it("sin storage disponible (null) -> leer da false, escribir nunca revienta", async () => {
    const mod = await cargarContentFresco();
    expect(mod.leerPanelMinimizado(null)).toBe(false);
    expect(() => mod.escribirPanelMinimizado(null, true)).not.toThrow();
  });
});
