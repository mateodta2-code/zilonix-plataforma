import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";

// Tarea 1.5 — toda ruta cerrada por defecto (regla de CLAUDE.md), salvo
// las que se listan acá explícitamente. Mismo criterio que ya usa
// Zilonix OS: la excepción se justifica, nunca por omisión.
const esRutaPublica = createRouteMatcher([
  "/",
  "/api/version",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Tarea 1.7 — quien recibe una invitación por correo todavía no
  // tiene sesión (puede ni tener cuenta). La propia página valida el
  // token contra la base (lib/invitaciones.ts) — el permiso real es
  // ese token, no el middleware.
  "/invitacion(.*)",
]);

// Tarea 1.10 — "límite de peticiones por usuario y por IP". La lógica
// en sí vive en lib/limite-peticiones.ts (probada sola, sin Next ni
// Clerk); acá solo se decide CUÁNDO y con QUÉ clave llamarla.
//
// Configurable por variable de entorno (pedido real de Mateo, 21/10:
// en plena construcción, probando a mano y con curls repetidos contra
// staging, el límite pensado para tráfico real de producción frena el
// trabajo sin que haya ningún abuso real que proteger todavía). En
// producción, sin la variable puesta, se queda en el valor estricto de
// siempre — este cambio nunca afloja nada ahí por accidente.
const VENTANA_MS = 60_000;
const LIMITE_POR_IP = Number(process.env.LIMITE_PETICIONES_POR_IP) || 180; // ~3 peticiones por segundo sostenidas
const LIMITE_POR_USUARIO = Number(process.env.LIMITE_PETICIONES_POR_USUARIO) || 300; // más alto: varias pestañas/pestaña activa cuentan como el mismo usuario
const contadorPorIp = creaContador();
const contadorPorUsuario = creaContador();
let peticionesDesdeLimpieza = 0;

function ipDeLaPeticion(req: Request): string {
  // Railway (como la mayoría de PaaS) llega detrás de un proxy — la IP
  // real del visitante viene en x-forwarded-for, nunca en la conexión
  // directa. Sin IP identificable (caso raro), se agrupan todas bajo
  // una sola clave en vez de fallar — sigue limitando algo en vez de
  // no limitar nada.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
}

export default clerkMiddleware(async (auth, req) => {
  peticionesDesdeLimpieza += 1;
  if (peticionesDesdeLimpieza >= 500) {
    peticionesDesdeLimpieza = 0;
    limpiarVencidos(contadorPorIp, VENTANA_MS);
    limpiarVencidos(contadorPorUsuario, VENTANA_MS);
  }

  if (superaLimite(contadorPorIp, ipDeLaPeticion(req), LIMITE_POR_IP, VENTANA_MS)) {
    return new NextResponse("Demasiadas peticiones desde esta red — espera un minuto.", { status: 429 });
  }

  if (!esRutaPublica(req)) {
    await auth.protect();
  }

  const { userId } = await auth();
  if (userId && superaLimite(contadorPorUsuario, userId, LIMITE_POR_USUARIO, VENTANA_MS)) {
    return new NextResponse("Demasiadas peticiones de tu cuenta — espera un minuto.", { status: 429 });
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
