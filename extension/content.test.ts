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
    debeReescanearAuto: (interruptorEncendido: boolean, panelCerrado: boolean) => boolean;
    leerPanelCerrado: (storage: StorageFake | null) => boolean;
    escribirPanelCerrado: (storage: StorageFake | null, cerrado: boolean) => void;
    leerPanelMinimizado: (storage: StorageFake | null) => boolean;
    escribirPanelMinimizado: (storage: StorageFake | null, minimizado: boolean) => void;
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
// real del interruptor global (chrome.storage.local) y
// debeReescanearAuto decide si reescanear() (MutationObserver +
// setInterval, el mecanismo que antes volvía a inyectar el panel solo)
// tiene permiso para dibujar algo — sin DOM ni chrome real, un
// storage-fake alcanza.
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

describe("debeReescanearAuto — issue #273 (nunca reinyecta el panel solo)", () => {
  it("interruptor encendido y panel NO cerrado en esta pestaña -> true, se inyecta normal", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeReescanearAuto(true, false)).toBe(true);
  });

  it("interruptor APAGADO (aunque el panel no esté cerrado en esta pestaña) -> false, nunca inyecta", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeReescanearAuto(false, false)).toBe(false);
  });

  // Caso real del bug: la persona cerró el panel con la X en esta
  // pestaña, el interruptor global sigue encendido — antes de esta
  // tarea, el próximo tick del MutationObserver/intervalo lo volvía a
  // dibujar solo. Ahora corta acá, nunca llega a tocar el DOM.
  it("panel cerrado en esta pestaña (aunque el interruptor siga encendido) -> false, nunca se reinyecta solo", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeReescanearAuto(true, true)).toBe(false);
  });

  it("interruptor apagado Y panel cerrado -> false", async () => {
    const mod = await cargarContentFresco();
    expect(mod.debeReescanearAuto(false, true)).toBe(false);
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
