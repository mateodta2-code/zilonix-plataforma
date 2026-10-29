import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #273 (revisión de Pablo, punto 2) — config.js ya tenía el
// patrón dual module.exports/window.X (issue #174); esta tarea solo
// suma el comportamiento DINÁMICO: URL_APP arranca en producción (el
// default de siempre) y se actualiza con lo que chrome.storage.local
// tenga guardado en "zilonixUrlApp" (lo escribe marcador-zilonix.js).
const URL_APP_PRODUCCION = "https://web-production-af270.up.railway.app";
const URL_APP_STAGING = "https://web-staging-d979.up.railway.app";

async function cargarConfigFresco(chromeMock?: unknown) {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  if (chromeMock === undefined) {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  } else {
    (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  }
  return (await import("./config.js")) as unknown as { URL_APP: string };
}

describe("config.js — URL_APP dinámico (issue #273, revisión de Pablo)", () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("sin chrome.storage disponible (vitest, o la extensión con el contexto invalidado) -> URL_APP queda en producción, el default de siempre", async () => {
    const mod = await cargarConfigFresco();
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
  });

  it("sin nada guardado todavía en chrome.storage.local (primera vez que se usa esta versión) -> sigue en producción", async () => {
    const chromeMock = {
      storage: {
        local: {
          get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => cb(defaults),
        },
        onChanged: { addListener: () => {} },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
  });

  // Caso real del punto 2: marcador-zilonix.js ya guardó "zilonixUrlApp"
  // (la persona tiene staging abierto en /panel/investigacion) — config.js
  // lo lee al cargar, ANTES de que la persona haga clic en "Seguir en
  // Zilonix"/"Seguir tienda".
  it("con zilonixUrlApp ya guardado (staging) -> URL_APP se actualiza al leerlo", async () => {
    let callback: ((datos: Record<string, unknown>) => void) | null = null;
    const chromeMock = {
      storage: {
        local: {
          get: (_defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => {
            callback = cb;
          },
        },
        onChanged: { addListener: () => {} },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION); // todavía no resolvió el get (callback no se llamó)
    callback!({ zilonixUrlApp: URL_APP_STAGING });
    expect(mod.URL_APP).toBe(URL_APP_STAGING);
  });

  // chrome.storage.onChanged — "Seguir en Zilonix" en caliente, sin
  // recargar la ficha de Mercado Libre: si la persona abre staging en
  // otra pestaña DESPUÉS de que esta ficha ya cargó, el próximo clic
  // ya tiene que usar el ambiente nuevo.
  it("chrome.storage.onChanged con un cambio de zilonixUrlApp -> actualiza URL_APP en caliente", async () => {
    let onChangedCb: ((cambios: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
    const chromeMock = {
      storage: {
        local: { get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => cb(defaults) },
        onChanged: {
          addListener: (fn: (cambios: Record<string, { newValue?: unknown }>, area: string) => void) => {
            onChangedCb = fn;
          },
        },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
    onChangedCb!({ zilonixUrlApp: { newValue: URL_APP_STAGING } }, "local");
    expect(mod.URL_APP).toBe(URL_APP_STAGING);
  });

  it("chrome.storage.onChanged en otra área (ej. 'sync') o de otra clave -> se ignora", async () => {
    let onChangedCb: ((cambios: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
    const chromeMock = {
      storage: {
        local: { get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => cb(defaults) },
        onChanged: {
          addListener: (fn: (cambios: Record<string, { newValue?: unknown }>, area: string) => void) => {
            onChangedCb = fn;
          },
        },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    onChangedCb!({ zilonixUrlApp: { newValue: URL_APP_STAGING } }, "sync");
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
    onChangedCb!({ otraClave: { newValue: "x" } }, "local");
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
  });

  // Issue #44 (revisión de Pablo sobre el PR #290, LOW) — bug real
  // posible: un "zilonixUrlApp" que NO está en la allowlist (nunca
  // debería poder escribirse — marcador-zilonix.js ya lo valida antes
  // de guardar — pero esta es la capa que lee, nunca confía en que la
  // que escribe fue la única forma de llegar ahí) se ignora, tanto al
  // leer como en caliente.
  it("zilonixUrlApp guardado que NO está en la allowlist -> se ignora al leer, queda en producción", async () => {
    const chromeMock = {
      storage: {
        local: {
          get: (_defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => cb({ zilonixUrlApp: "https://evil.com" }),
        },
        onChanged: { addListener: () => {} },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
  });

  it("zilonixUrlApp que NO está en la allowlist, vía onChanged -> se ignora en caliente", async () => {
    let onChangedCb: ((cambios: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
    const chromeMock = {
      storage: {
        local: { get: (defaults: Record<string, unknown>, cb: (datos: Record<string, unknown>) => void) => cb(defaults) },
        onChanged: {
          addListener: (fn: (cambios: Record<string, { newValue?: unknown }>, area: string) => void) => {
            onChangedCb = fn;
          },
        },
      },
    };
    const mod = await cargarConfigFresco(chromeMock);
    onChangedCb!({ zilonixUrlApp: { newValue: "https://evil.com" } }, "local");
    expect(mod.URL_APP).toBe(URL_APP_PRODUCCION);
  });
});
