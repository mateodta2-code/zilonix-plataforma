import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El middleware real llama createRouteMatcher (el que parchea
// CVE-2026-41248) y después auth.protect() si la ruta no es pública.
// Acá se deja el matcher de verdad y solo se sustituye el envoltorio
// de Clerk: sin eso, protect() saldría a la red y el test dejaría de
// decir si el gate de ESTA rama dejó pasar la petición o no.
const mocks = vi.hoisted(() => ({
  protect: vi.fn(async () => {
    throw new Error("sesion-requerida");
  }),
}));

vi.mock("server-only", () => ({}));

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  // Cast: clerkMiddleware tiene varias firmas (handler, opciones, o la
  // petición directa). El middleware de la app solo usa la primera.
  const clerkMiddleware = ((handler: (auth: unknown, req: NextRequest) => Promise<Response | undefined>) => {
    return async (req: NextRequest) => {
      const auth = Object.assign(async () => ({ userId: null }), {
        protect: mocks.protect,
      });
      return handler(auth, req);
    };
  }) as unknown as typeof actual.clerkMiddleware;
  return { ...actual, clerkMiddleware };
});

import middleware from "./middleware";

const ORIGEN = "https://staging.zilonix.test";
let ip = 0;

// "pasa" = el middleware no exigió sesión y no respondió con un error.
// "bloqueada" = llamó auth.protect() (sin sesión, eso es el gate).
// "malformada" = el matcher del parche rechazó el path (Clerk lo vuelve
// 400 en el envoltorio real; acá el mock no lo atrapa, así que se ve
// el throw). Ninguno de los dos últimos es "la petición siguió".
async function decidir(path: string): Promise<"pasa" | "bloqueada" | "malformada"> {
  mocks.protect.mockClear();
  ip += 1;
  const req = new NextRequest(`${ORIGEN}${path}`, {
    headers: { "x-forwarded-for": `203.0.113.${ip}` },
  });
  try {
    const respuesta = await middleware(req, undefined as never);
    if (mocks.protect.mock.calls.length > 0) return "bloqueada";
    if (respuesta && respuesta.status >= 400) return "bloqueada";
    return "pasa";
  } catch (error) {
    if (error instanceof Error && error.name === "MalformedURLError") return "malformada";
    if (mocks.protect.mock.calls.length > 0) return "bloqueada";
    throw error;
  }
}

beforeEach(() => {
  mocks.protect.mockClear();
});

describe("middleware tras @clerk/nextjs 6.39.8", () => {
  it("deja pasar las rutas públicas sin sesión", async () => {
    const publicas = ["/", "/api/version", "/sign-in", "/sign-up", "/sign-up/continue", "/invitacion/un-token"];
    for (const ruta of publicas) {
      expect(await decidir(ruta), ruta).toBe("pasa");
    }
  });

  it("deja pasar la forma normalizada de una ruta pública (el matcher parcheado decodifica y colapsa barras)", async () => {
    // Sin el parche, /%73ign-in no coincide con /sign-in(.*) y el gate
    // la trataría como privada. Con 6.39.2+ decodeURI la reconoce y
    // sigue siendo pública — y una ruta privada codificada no se cuela
    // por ese mismo camino (eso está en el test de abajo).
    const publicas = ["/%73ign-in", "//sign-in", "///sign-in/factor-one", "/%69nvitacion/abc"];
    for (const ruta of publicas) {
      expect(await decidir(ruta), ruta).toBe("pasa");
    }
  });

  it("bloquea rutas privadas sin sesión", async () => {
    const privadas = [
      "/panel",
      "/panel/pedidos",
      "/cuenta",
      "/crear-empresa",
      "/superadmin",
      "/api/ml/conectar",
      "/api/ml/despachos/etiquetas",
    ];
    for (const ruta of privadas) {
      expect(await decidir(ruta), ruta).toBe("bloqueada");
    }
  });

  it("una variante armada de una ruta privada no pasa como pública", async () => {
    // Misma clase de path que el advisory (mayúsculas, %2F, doble
    // barra, ';', punto final, encoding), sin reproducir un exploit:
    // ninguna de estas tiene que coincidir con la lista pública.
    const armadas = [
      "/PANEL",
      "//panel",
      "///panel",
      "/panel;",
      "/panel.",
      "/%70anel",
      "/panel%2Fsecret",
      "/%2Fpanel",
      "/panel%2e",
      "/api%2Fversion",
      "/API/ml/webhooks",
    ];
    for (const ruta of armadas) {
      expect(await decidir(ruta), ruta).not.toBe("pasa");
    }
  });

  it("un path mal codificado no sigue de largo", async () => {
    expect(await decidir("/%zz")).toBe("malformada");
  });

  it("webhooks, trabajador y callback siguen detrás del gate de sesión en esta rama", async () => {
    // En main estas tres NO están en esRutaPublica. Dejarlas pasar es
    // el cambio de middleware del PR #27 (lib/rutas-publicas.ts), que
    // además deja de usar auth.protect() porque el rewrite de Clerk se
    // cuelga en Railway — eso no se arregla subiendo la dependencia.
    // Abrirlas acá, sin el chequeo de application_id que ese PR agrega
    // al webhook, mezclaría los dos cambios. El upgrade no las abre.
    const maquina = ["/api/ml/webhooks", "/api/ml/trabajador", "/api/ml/callback"];
    for (const ruta of maquina) {
      expect(await decidir(ruta), ruta).toBe("bloqueada");
    }
  });
});
