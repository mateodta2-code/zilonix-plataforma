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
type MensajeListener = (mensaje: Record<string, unknown>, remitente: unknown, sendResponse: (respuesta?: unknown) => void) => void;

async function cargarMarcadorFresco(
  origin: string,
  opts: { pathname?: string; chromeExtra?: Record<string, unknown>; sendMessageImpl?: (mensaje: unknown, cb?: (respuesta?: unknown) => void) => void } = {}
) {
  vi.resetModules();
  const llamadasSet: Array<Record<string, unknown>> = [];
  const atributos: Record<string, string> = {};
  const mensajesPostMessage: Array<Record<string, unknown>> = [];
  let onMessageListener: MensajeListener | null = null;
  let onWindowMessageListener: ((evento: { source: unknown; origin: string; data: unknown }) => void) | null = null;

  (globalThis as unknown as { document: unknown }).document = {
    documentElement: {
      setAttribute: (clave: string, valor: string) => {
        atributos[clave] = valor;
      },
    },
  };
  const pathname = opts.pathname ?? "/panel/investigacion";
  const ventana = {
    location: { origin, pathname },
    addEventListener: (tipo: string, fn: (evento: { source: unknown; origin: string; data: unknown }) => void) => {
      if (tipo === "message") onWindowMessageListener = fn;
    },
    postMessage: (mensaje: Record<string, unknown>) => {
      mensajesPostMessage.push(mensaje);
    },
  };
  (globalThis as unknown as { window: unknown }).window = ventana;
  // Issue #44 — `location` (identificador global, sin "window.") es lo
  // que esPaginaPublicar() lee de verdad (igual que en un content
  // script real, donde `location` sin más YA es `window.location`) —
  // en vitest hace falta este global aparte, `window.location` no alcanza.
  (globalThis as unknown as { location: unknown }).location = ventana.location;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: MensajeListener) => {
          onMessageListener = fn;
        },
      },
      sendMessage: opts.sendMessageImpl ?? (() => {}),
      lastError: undefined,
    },
    storage: {
      local: {
        set: (obj: Record<string, unknown>) => {
          llamadasSet.push(obj);
        },
      },
    },
    ...opts.chromeExtra,
  };

  const mod = (await import("./marcador-zilonix.js")) as unknown as {
    debeGuardarUrlApp: (origin: string, origenesPermitidos: string[]) => boolean;
    esPaginaPublicar: () => boolean;
  };
  return {
    mod,
    llamadasSet,
    atributos,
    mensajesPostMessage,
    enviarDesdeBackground: (mensaje: Record<string, unknown>, sendResponse: (respuesta?: unknown) => void = () => {}) => {
      onMessageListener!(mensaje, {}, sendResponse);
    },
    // Simula un postMessage mandado por la PÁGINA (PaginaPublicar.tsx,
    // "publicar-listo") — mismo chequeo real que hace marcador-zilonix.js
    // (source === window, origin === window.location.origin).
    enviarDesdeLaPagina: (datos: Record<string, unknown>) => {
      onWindowMessageListener!({ source: ventana, origin, data: datos });
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { location?: unknown }).location;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.useRealTimers();
});

describe("marcador-zilonix.js — guardar zilonixUrlApp solo desde un origin permitido (issue #273, revisión de Pablo)", () => {
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

describe("esPaginaPublicar — issue #44", () => {
  it('"/panel/publicar" (y cualquier subruta) -> true', async () => {
    const { mod } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", { pathname: "/panel/publicar" });
    expect(mod.esPaginaPublicar()).toBe(true);
  });

  it('"/panel/investigacion" -> false', async () => {
    const { mod } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", { pathname: "/panel/investigacion" });
    expect(mod.esPaginaPublicar()).toBe(false);
  });

  it('"/panel/investigacion/seguimiento" -> false', async () => {
    const { mod } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", { pathname: "/panel/investigacion/seguimiento" });
    expect(mod.esPaginaPublicar()).toBe(false);
  });
});

// Issue #44 (revisión de Pablo sobre el PR #290) — bug real: el ack de
// "zilonix:importar-publicar" respondía {ok:true} desde CUALQUIER ruta
// de Seller — background.js ("Importar a Publicar" abre/enfoca
// Publicar) necesita distinguir de verdad si la pestaña que contestó
// es /panel/publicar.
describe('ack de "zilonix:importar-publicar" — issue #44 (SOLO desde /panel/publicar)', () => {
  it("en /panel/publicar -> ack {ok:true, publicar:true}, y sigue reenviando el postMessage de siempre", async () => {
    const { enviarDesdeBackground, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
    });
    const respuestas: unknown[] = [];
    enviarDesdeBackground({ tipo: "zilonix:importar-publicar", payload: { titulo: "Reloj" } }, (r) => respuestas.push(r));
    expect(respuestas).toEqual([{ ok: true, publicar: true }]);
    expect(mensajesPostMessage).toEqual([{ fuente: "zilonix-extension", tipo: "importar-publicar", payload: { titulo: "Reloj" } }]);
  });

  it("en /panel/investigacion (NUNCA Publicar) -> ack {ok:true, publicar:false} — background.js nunca la confunde con una pestaña real de Publicar", async () => {
    const { enviarDesdeBackground, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/investigacion",
    });
    const respuestas: unknown[] = [];
    enviarDesdeBackground({ tipo: "zilonix:importar-publicar", payload: { titulo: "Reloj" } }, (r) => respuestas.push(r));
    expect(respuestas).toEqual([{ ok: true, publicar: false }]);
    // El reenvío (postMessage) sigue pasando igual que siempre -- solo
    // el ACK cambia según la ruta, nunca el reenvío en sí.
    expect(mensajesPostMessage).toEqual([{ fuente: "zilonix-extension", tipo: "importar-publicar", payload: { titulo: "Reloj" } }]);
  });

  it('otros tipos (ej. "zilonix:vendidos") siguen con el ack simple {ok:true}, sin "publicar", en cualquier ruta', async () => {
    const { enviarDesdeBackground } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", { pathname: "/panel/investigacion" });
    const respuestas: unknown[] = [];
    enviarDesdeBackground({ tipo: "zilonix:vendidos", payload: { itemId: "MCO1" } }, (r) => respuestas.push(r));
    expect(respuestas).toEqual([{ ok: true }]);
  });
});

// Issue #44 — pedirImportacionPendiente() es lo que de verdad entrega
// el payload guardado por background.js a la página, una vez que
// /panel/publicar está lista. Se dispara por 2 caminos: la señal
// "publicar-listo" de la página (primario) y un reintento acotado de
// seguridad (ver más abajo).
describe("pedirImportacionPendiente — issue #44 (entrega el pendiente a /panel/publicar)", () => {
  it('"publicar-listo" desde la página pide el pendiente a background y lo reenvía con postMessage', async () => {
    const sendMessageImpl = vi.fn((_mensaje: unknown, cb?: (respuesta?: unknown) => void) => {
      cb?.({ payload: { titulo: "Cojín", precio: 50000 } });
    });
    const { enviarDesdeLaPagina, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
      sendMessageImpl,
    });
    enviarDesdeLaPagina({ fuente: "zilonix-panel", tipo: "publicar-listo" });
    expect(sendMessageImpl).toHaveBeenCalledWith({ tipo: "zilonix:pedir-importacion-pendiente" }, expect.any(Function));
    expect(mensajesPostMessage).toContainEqual({
      fuente: "zilonix-extension",
      tipo: "importar-publicar",
      payload: { titulo: "Cojín", precio: 50000 },
    });
  });

  it("sin nada pendiente (background responde sin payload) -> nunca manda un postMessage vacío/inventado", async () => {
    const sendMessageImpl = vi.fn((_mensaje: unknown, cb?: (respuesta?: unknown) => void) => cb?.({ payload: null }));
    const { enviarDesdeLaPagina, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
      sendMessageImpl,
    });
    enviarDesdeLaPagina({ fuente: "zilonix-panel", tipo: "publicar-listo" });
    expect(mensajesPostMessage).toEqual([]);
  });

  it('"publicar-listo" en una pestaña que NO es /panel/publicar -> nunca le pregunta nada a background.js', async () => {
    const sendMessageImpl = vi.fn();
    const { enviarDesdeLaPagina } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/investigacion",
      sendMessageImpl,
    });
    enviarDesdeLaPagina({ fuente: "zilonix-panel", tipo: "publicar-listo" });
    expect(sendMessageImpl).not.toHaveBeenCalled();
  });

  // Issue #44 — red de seguridad: 3 reintentos acotados (1s/2s/4s) por
  // si la señal "publicar-listo" se pierde (ej. un build cacheado sin
  // el aviso todavía) — NUNCA indefinido, y sin este reintento el
  // pendiente se quedaría varado para siempre si el aviso no llega.
  it("sin ninguna señal 'publicar-listo', los reintentos acotados igual terminan pidiendo el pendiente", async () => {
    vi.useFakeTimers();
    const sendMessageImpl = vi.fn((_mensaje: unknown, cb?: (respuesta?: unknown) => void) => cb?.({ payload: { titulo: "Reintento" } }));
    const { mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
      sendMessageImpl,
    });
    expect(sendMessageImpl).not.toHaveBeenCalled(); // nada todavía, ni "publicar-listo" ni el primer reintento
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessageImpl).toHaveBeenCalledTimes(1);
    expect(mensajesPostMessage).toContainEqual({ fuente: "zilonix-extension", tipo: "importar-publicar", payload: { titulo: "Reintento" } });
  });

  it("los reintentos NUNCA se programan fuera de /panel/publicar", async () => {
    vi.useFakeTimers();
    const sendMessageImpl = vi.fn();
    await cargarMarcadorFresco("https://web-production-af270.up.railway.app", { pathname: "/panel/investigacion", sendMessageImpl });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendMessageImpl).not.toHaveBeenCalled();
  });
});

// Issue #44 (anexo, "Traer datos de ese link") — las 2 entradas nuevas
// de este mapa: PÁGINA -> extensión ("importar-link", el clic real en
// "Traer datos de ese link") y extensión -> PÁGINA ("zilonix:importar-link-error",
// background.js avisando que el link no era de Mercado Libre, pidió
// login/captcha, o se agotó el tiempo). Mismo mecanismo genérico de
// siempre (TIPOS_HACIA_EXTENSION / TIPOS_REENVIADOS) — estas pruebas
// solo confirman que las 2 entradas nuevas están bien cableadas.
describe('"importar-link" / "zilonix:importar-link-error" — issue #44 (anexo, Traer datos de ese link)', () => {
  it('la página manda "importar-link" (postMessage) -> se reenvía a background.js como "zilonix:importar-link"', async () => {
    const sendMessageImpl = vi.fn();
    const { enviarDesdeLaPagina } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
      sendMessageImpl,
    });
    enviarDesdeLaPagina({ fuente: "zilonix-panel", tipo: "importar-link", payload: { link: "https://articulo.mercadolibre.com.co/MCO-123" } });
    expect(sendMessageImpl).toHaveBeenCalledWith(
      { tipo: "zilonix:importar-link", payload: { link: "https://articulo.mercadolibre.com.co/MCO-123" } },
      expect.any(Function)
    );
  });

  it('background.js manda "zilonix:importar-link-error" -> se reenvía a la página (postMessage) como "importar-link-error", con el ack simple {ok:true}', async () => {
    const { enviarDesdeBackground, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
    });
    const respuestas: unknown[] = [];
    enviarDesdeBackground({ tipo: "zilonix:importar-link-error", payload: { razon: "captcha" } }, (r) => respuestas.push(r));
    expect(mensajesPostMessage).toContainEqual({ fuente: "zilonix-extension", tipo: "importar-link-error", payload: { razon: "captcha" } });
    expect(respuestas).toEqual([{ ok: true }]); // tipo genérico -- nunca el ack especial de "importar-publicar"
  });

  it('"zilonix:importar-link-error" también se reenvía en una pestaña que NO es /panel/publicar (background.js nunca lo difunde a ciegas, pero marcador-zilonix.js no filtra por ruta en este tipo)', async () => {
    const { enviarDesdeBackground, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/investigacion",
    });
    enviarDesdeBackground({ tipo: "zilonix:importar-link-error", payload: { razon: "timeout" } });
    expect(mensajesPostMessage).toContainEqual({ fuente: "zilonix-extension", tipo: "importar-link-error", payload: { razon: "timeout" } });
  });

  it('sin payload en "zilonix:importar-link-error" -> no reenvía nada (mismo chequeo genérico de siempre, "if (!mensaje || !mensaje.payload) return")', async () => {
    const { enviarDesdeBackground, mensajesPostMessage } = await cargarMarcadorFresco("https://web-production-af270.up.railway.app", {
      pathname: "/panel/publicar",
    });
    enviarDesdeBackground({ tipo: "zilonix:importar-link-error" });
    expect(mensajesPostMessage).toEqual([]);
  });
});
