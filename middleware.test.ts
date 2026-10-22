import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fix real (2026-10-21) — clerkMiddleware(handler) solo envuelve el
// handler real para integrarlo con Clerk; mockearlo como identidad deja
// probar el handler de middleware.ts directo, sin necesitar el runtime
// completo de Clerk. vi.resetModules() + import dinámico en cada
// prueba: los contadores de lib/limite-peticiones.ts son estado a
// nivel de módulo (a propósito, ver ese archivo) — sin esto, una
// prueba dejaría el contador "caliente" para la siguiente.
//
// Merge con main (Clerk 6.39.8, CVE-2026-41248) — @clerk/nextjs/server
// importa "server-only" desde esta versión; sin mockearlo, vitest
// (Node, no un Server Component real) revienta al importar el módulo.
vi.mock("server-only", () => ({}));

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  // createRouteMatcher tiene que seguir siendo el real: lib/rutas-
  // publicas.ts (que importa de este mismo módulo) lo necesita de
  // verdad para construir esRutaPublica — y es justo el que trae el
  // parche del CVE (decodeURI + colapso de barras repetidas).
  const real = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...real, clerkMiddleware: (handler: unknown) => handler };
});

type SesionFalsa = { userId: string | null; redirectToSignIn: (opts: { returnBackUrl: string }) => Response };
type HandlerDeVerdad = (auth: () => Promise<SesionFalsa>, req: NextRequest) => Promise<Response | undefined>;

async function cargarMiddleware(): Promise<HandlerDeVerdad> {
  const mod = await import("./middleware");
  return mod.default as unknown as HandlerDeVerdad;
}

function authFalso(userId: string | null) {
  const redirectToSignIn = vi.fn(() => new Response(null, { status: 307 }));
  const auth = vi.fn(async (): Promise<SesionFalsa> => ({ userId, redirectToSignIn }));
  return { auth, redirectToSignIn };
}

function peticion(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("middleware — límite de peticiones y returnBackUrl (fix, 2026-10-21)", () => {
  const envOriginal = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it(
    "el webhook de Mercado Libre tiene su propio límite (1200), no el general (180) — 181 peticiones de la misma IP no dan 429",
    async () => {
      const middleware = await cargarMiddleware();
      const { auth } = authFalso("u1");
      const req = () => peticion("https://x.test/api/ml/webhooks", { "x-forwarded-for": "203.0.113.5" });

      // Estabilidad de CI (sin issue de producto): 181 es el mínimo real
      // que prueba la regla — uno más que el límite general (180,
      // LIMITE_POR_IP en middleware.ts), para demostrar que esta ruta NO
      // usa ese contador. Nunca hace falta llegar a los 1200 del límite
      // propio del webhook para probarlo. Antes eran 200 iteraciones, que
      // a veces daban timeout de 5s corriendo en paralelo con el resto de
      // la suite — se bajan las iteraciones y, además, se le da un
      // timeout explícito más holgado (acá sí puede importar cuánto tarde
      // el resto de la suite, nunca la lógica que se está probando).
      let ultimaRespuesta;
      for (let i = 0; i < 181; i++) {
        ultimaRespuesta = await middleware(auth, req());
      }
      expect(ultimaRespuesta?.status).not.toBe(429);
    },
    15000
  );

  it("una ruta normal SÍ respeta el límite general (180) con la misma IP", async () => {
    const middleware = await cargarMiddleware();
    const { auth } = authFalso("u1");
    const req = () => peticion("https://x.test/panel", { "x-forwarded-for": "203.0.113.9" });

    let ultimaRespuesta;
    for (let i = 0; i < 200; i++) {
      ultimaRespuesta = await middleware(auth, req());
    }
    expect(ultimaRespuesta?.status).toBe(429);
  });

  it("returnBackUrl usa RAILWAY_PUBLIC_DOMAIN + pathname + search, nunca req.url", async () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = "web-staging-d979.up.railway.app";
    const middleware = await cargarMiddleware();
    const { auth, redirectToSignIn } = authFalso(null);

    // A propósito con un host distinto al dominio público real — el
    // mismo bug real que ya forzó RAILWAY_PUBLIC_DOMAIN en
    // lib/url-publica.ts (tarea 1.12): detrás del proxy, "host" puede
    // no ser el dominio público.
    await middleware(auth, peticion("http://localhost:3000/panel/conectar-ml?foo=bar", { "x-forwarded-for": "203.0.113.50" }));

    expect(redirectToSignIn).toHaveBeenCalledWith({ returnBackUrl: "https://web-staging-d979.up.railway.app/panel/conectar-ml?foo=bar" });
  });

  it("sin RAILWAY_PUBLIC_DOMAIN, returnBackUrl usa req.nextUrl.origin — nunca x-forwarded-host a mano", async () => {
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    const middleware = await cargarMiddleware();
    const { auth, redirectToSignIn } = authFalso(null);

    // x-forwarded-host dice una cosa distinta a propósito — si el
    // fallback todavía la leyera, el returnBackUrl saldría con ese
    // valor en vez del origin real del request.
    await middleware(
      auth,
      peticion("https://web-staging-d979.up.railway.app/panel/conectar-ml?foo=bar", {
        "x-forwarded-for": "203.0.113.70",
        "x-forwarded-host": "un-host-cualquiera-que-no-deberia-usarse.test",
      })
    );

    expect(redirectToSignIn).toHaveBeenCalledWith({
      returnBackUrl: "https://web-staging-d979.up.railway.app/panel/conectar-ml?foo=bar",
    });
  });

  it("sin sesión en una ruta de API no pública -> 401 JSON inmediato, nunca redirectToSignIn", async () => {
    const middleware = await cargarMiddleware();
    const { auth, redirectToSignIn } = authFalso(null);

    const res = await middleware(auth, peticion("https://x.test/api/ml/conectar", { "x-forwarded-for": "203.0.113.60" }));

    expect(res?.status).toBe(401);
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});

// Merge con main (Clerk 6.39.8, CVE-2026-41248: createRouteMatcher se
// podía saltar con un path armado). Adaptado del test que trajo ese
// upgrade (PR #78) al mismo arnés de arriba (authFalso/cargarMiddleware)
// en vez del mock propio de auth.protect() que traía: esta rama ya no
// llama auth.protect() en ningún caso (ver middleware.ts), así que
// detectar "bloqueada" por esa llamada ya no sirve — acá se detecta por
// redirectToSignIn() (páginas) o por el status de la respuesta (APIs,
// 401 json), que es como de verdad bloquea esta rama.
describe("middleware — coincidencia de rutas tras @clerk/nextjs 6.39.8 (CVE-2026-41248)", () => {
  let ip = 0;

  async function decidir(path: string): Promise<"pasa" | "bloqueada" | "malformada"> {
    try {
      ip += 1;
      const req = peticion(`https://staging.zilonix.test${path}`, { "x-forwarded-for": `203.0.113.${ip}` });
      const middleware = await cargarMiddleware();
      const { auth, redirectToSignIn } = authFalso(null);
      const respuesta = await middleware(auth, req);
      if (redirectToSignIn.mock.calls.length > 0) return "bloqueada";
      if (respuesta && respuesta.status >= 400) return "bloqueada";
      return "pasa";
    } catch (error) {
      // No solo new NextRequest(...) puede tirar esto: el matcher
      // parcheado de Clerk (createRouteMatcher, llamado dentro de
      // middleware.ts vía esRutaPublica) también revienta con
      // MalformedURLError al decodificar un path como /%zz — hay que
      // envolver la llamada al middleware completa, no solo la
      // construcción del request.
      if (error instanceof Error && error.name === "MalformedURLError") return "malformada";
      throw error;
    }
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("deja pasar las rutas públicas sin sesión, incluidas sus variantes codificadas/con barras repetidas", async () => {
    const publicas = [
      "/",
      "/api/version",
      "/sign-in",
      "/sign-up",
      "/sign-up/continue",
      "/invitacion/un-token",
      // Sin el parche, /%73ign-in no coincide con /sign-in(.*) y el gate
      // la trataría como privada. Con 6.39.2+ decodeURI la reconoce y
      // sigue siendo pública.
      "/%73ign-in",
      "//sign-in",
      "///sign-in/factor-one",
      "/%69nvitacion/abc",
      // Hallazgo real al fusionar main (Clerk 6.39.8): el matcher
      // parcheado compara sin distinguir mayúsculas/minúsculas, así
      // que una variante en mayúsculas de una ruta pública también
      // coincide ahora — antes (6.9.6) no lo hacía.
      "/API/ml/webhooks",
    ];
    for (const ruta of publicas) {
      expect(await decidir(ruta), ruta).toBe("pasa");
    }
  });

  it("bloquea rutas privadas sin sesión, incluidas variantes armadas (mismo patrón que el CVE, sin reproducir el exploit)", async () => {
    const privadas = [
      "/panel",
      "/panel/pedidos",
      "/cuenta",
      "/crear-empresa",
      "/superadmin",
      "/api/ml/conectar",
      "/api/ml/despachos/etiquetas",
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
      // Nota real: /API/ml/webhooks (mayúsculas) NO va acá — a
      // diferencia de 6.9.6, el matcher parcheado compara sin
      // distinguir mayúsculas/minúsculas, así que esa variante SÍ
      // coincide con el patrón público "/api/ml/webhooks" (ver el
      // "it" de rutas públicas, más abajo). Acá se prueba el mismo
      // caso contra una ruta que de verdad es privada en cualquier
      // mayúscula/minúscula.
      "/API/ml/conectar",
    ];
    for (const ruta of privadas) {
      expect(await decidir(ruta), ruta).toBe("bloqueada");
    }
  });

  it("un path mal codificado no sigue de largo", async () => {
    expect(await decidir("/%zz")).toBe("malformada");
  });

  it("webhooks, trabajador y callback son públicos en esta rama — su propio mecanismo de autenticación, no la sesión de Clerk del middleware", async () => {
    // En main (antes de fusionar este PR) estas tres seguían detrás del
    // gate de sesión — hacerlas públicas es justo el cambio de
    // middleware que trae el PR #27 (ver lib/rutas-publicas.ts).
    const maquina = ["/api/ml/webhooks", "/api/ml/trabajador", "/api/ml/callback"];
    for (const ruta of maquina) {
      expect(await decidir(ruta), ruta).toBe("pasa");
    }
  });
});
