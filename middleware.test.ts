import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fix real (2026-10-21) — clerkMiddleware(handler) solo envuelve el
// handler real para integrarlo con Clerk; mockearlo como identidad deja
// probar el handler de middleware.ts directo, sin necesitar el runtime
// completo de Clerk. vi.resetModules() + import dinámico en cada
// prueba: los contadores de lib/limite-peticiones.ts son estado a
// nivel de módulo (a propósito, ver ese archivo) — sin esto, una
// prueba dejaría el contador "caliente" para la siguiente.
vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  // createRouteMatcher tiene que seguir siendo el real: lib/rutas-
  // publicas.ts (que importa de este mismo módulo) lo necesita de
  // verdad para construir esRutaPublica.
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

  it("el webhook de Mercado Libre tiene su propio límite (1200), no el general (180) — 200 peticiones de la misma IP no dan 429", async () => {
    const middleware = await cargarMiddleware();
    const { auth } = authFalso("u1");
    const req = () => peticion("https://x.test/api/ml/webhooks", { "x-forwarded-for": "203.0.113.5" });

    let ultimaRespuesta;
    for (let i = 0; i < 200; i++) {
      ultimaRespuesta = await middleware(auth, req());
    }
    expect(ultimaRespuesta?.status).not.toBe(429);
  });

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

  it("sin sesión en una ruta de API no pública -> 401 JSON inmediato, nunca redirectToSignIn", async () => {
    const middleware = await cargarMiddleware();
    const { auth, redirectToSignIn } = authFalso(null);

    const res = await middleware(auth, peticion("https://x.test/api/ml/conectar", { "x-forwarded-for": "203.0.113.60" }));

    expect(res?.status).toBe(401);
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});
