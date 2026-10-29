import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #273 (revisión de Pablo, punto 2) — marcador-zilonix.js es un
// content script clásico (IIFE sin "type": "module", igual que
// background.js/content.js) que corre SOLO en las páginas de Seller
// (/panel/*, ver "matches" en manifest.json) y arranca solo al cargar
// — nunca exportaba nada hasta esta tarea. Para poder probar
// debeGuardarUrlApp (la función pura detrás de "guardar zilonixUrlApp
// solo desde un origin permitido") sin un navegador real, se agrega el
// mismo patrón dual module.exports/window.X que ya usa el resto de la
// extensión.
async function cargarMarcadorFresco(origin: string) {
  vi.resetModules();
  const llamadasSet: Array<Record<string, unknown>> = [];
  const atributos: Record<string, string> = {};

  (globalThis as unknown as { document: unknown }).document = {
    documentElement: {
      setAttribute: (clave: string, valor: string) => {
        atributos[clave] = valor;
      },
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    location: { origin },
    addEventListener: () => {},
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      lastError: undefined,
    },
    storage: {
      local: {
        set: (obj: Record<string, unknown>) => {
          llamadasSet.push(obj);
        },
      },
    },
  };

  const mod = (await import("./marcador-zilonix.js")) as unknown as {
    debeGuardarUrlApp: (origin: string, origenesPermitidos: string[]) => boolean;
  };
  return { mod, llamadasSet, atributos };
}

describe("marcador-zilonix.js — guardar zilonixUrlApp solo desde un origin permitido (issue #273, revisión de Pablo)", () => {
  afterEach(() => {
    delete (globalThis as unknown as { document?: unknown }).document;
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("origen de PRODUCCIÓN (ya en los matches del manifest) -> guarda zilonixUrlApp", async () => {
    const { llamadasSet } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app");
    expect(llamadasSet).toEqual([{ zilonixUrlApp: "https://web-production-af270.up.railway.app" }]);
  });

  it("origen de STAGING (ya en los matches del manifest) -> guarda zilonixUrlApp", async () => {
    const { llamadasSet } = await cargarMarcadorFresco("https://web-staging-d979.up.railway.app");
    expect(llamadasSet).toEqual([{ zilonixUrlApp: "https://web-staging-d979.up.railway.app" }]);
  });

  // Caso real que esta prueba evita: un origin cualquiera (nunca
  // autorizado por el manifest, nunca pudo haber corrido este content
  // script en producción real) no tiene que poder pisar zilonixUrlApp
  // -- la prueba igual confirma el comportamiento defensivo.
  it("un origen AJENO -> se ignora, nunca se guarda", async () => {
    const { llamadasSet } = await cargarMarcadorFresco("https://sitio-cualquiera.com");
    expect(llamadasSet).toEqual([]);
  });

  it("sigue poniendo el atributo data-zilonix-extension, sin cambios", async () => {
    const { atributos } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app");
    expect(atributos["data-zilonix-extension"]).toBe("1");
  });

  it("debeGuardarUrlApp — puro, mismo criterio sin side effects", async () => {
    const { mod } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app");
    const permitidos = ["https://web-production-af270.up.railway.app", "https://web-staging-d979.up.railway.app"];
    expect(mod.debeGuardarUrlApp("https://web-production-af270.up.railway.app", permitidos)).toBe(true);
    expect(mod.debeGuardarUrlApp("https://web-staging-d979.up.railway.app", permitidos)).toBe(true);
    expect(mod.debeGuardarUrlApp("https://evil.com", permitidos)).toBe(false);
    expect(mod.debeGuardarUrlApp(null as unknown as string, permitidos)).toBe(false);
    expect(mod.debeGuardarUrlApp("https://web-production-af270.up.railway.app", null as unknown as string[])).toBe(false);
  });
});
