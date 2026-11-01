import { NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";
import { esRutaPublica } from "@/lib/rutas-publicas";

// Tarea 1.5 — toda ruta cerrada por defecto (regla de CLAUDE.md), salvo
// las que se listan explícitamente en lib/rutas-publicas.ts (se saca a
// su propio archivo en el fix de 2026-10-21 — ver ese archivo para el
// motivo real y la lista completa).

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

// Mismo criterio real que lib/url-publica.ts (tarea 1.12: el header
// "host" detrás del proxy de Railway puede no ser el dominio público
// real) — reescrito acá sin next/headers porque el middleware corre en
// una etapa previa a los Route Handlers/Server Components, donde esa
// función no tiene su almacenamiento interno disponible.
//
// Corregido: el respaldo sin RAILWAY_PUBLIC_DOMAIN ya no lee
// x-forwarded-host a mano — cualquiera puede mandar esa cabecera, y
// Next.js no la valida por su cuenta. req.nextUrl.origin es el que
// Next.js ya resolvió para este request (protocolo + host juntos),
// nunca un valor que llegue sin pasar por su propio parseo.
function urlPublicaBaseDesdeMiddleware(req: NextRequest): string {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return req.nextUrl.origin;
}

function ipDeLaPeticion(req: Request): string {
  // Railway (como la mayoría de PaaS) llega detrás de un proxy — la IP
  // real del visitante viene en x-forwarded-for, nunca en la conexión
  // directa. Sin IP identificable (caso raro), se agrupan todas bajo
  // una sola clave en vez de fallar — sigue limitando algo en vez de
  // no limitar nada.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
}

// Fix real (2026-10-21) — el webhook de Mercado Libre (ver
// lib/rutas-publicas.ts) recibe avisos de TODAS las cuentas conectadas
// de TODAS las empresas, probablemente desde un puñado de IPs
// compartidas del lado de Mercado Libre — el límite por IP pensado
// para una persona (180/min) podría frenar tráfico real sin que haya
// ningún abuso, justo cuando más cuentas haya conectadas. Cuenta
// aparte, bastante más generosa — nunca se le exime del límite por
// completo (sigue siendo una URL pública en internet).
const RUTA_WEBHOOKS_ML = "/api/ml/webhooks";
const LIMITE_WEBHOOKS_ML = 1200;
const contadorWebhooksMl = creaContador();

export default clerkMiddleware(async (auth, req) => {
  // Opcional/deseable (digest 960283135, bug real en vivo en staging):
  // Clerk completa ciertos pasos de login (SSO, verificación por link)
  // navegando a "<ruta actual>/sso-callback" — si la "ruta actual" en
  // ese momento es la página protegida a la que la persona quería
  // volver (returnBackUrl, más abajo) en vez de /sign-in, ese
  // "sso-callback" se cuela como si fuera un segmento real de esa ruta
  // (ej. /panel/pedidos/sso-callback, donde [id] se lo come — eq() con
  // ese valor contra una columna uuid revienta Postgres). La defensa de
  // cada [id] (ver lib/validacion.ts) ya evita el 500; esto corrige la
  // URL ANTES de llegar ahí, para que el handshake de Clerk termine de
  // verdad en SU propia ruta (app/sign-in/[[...sign-in]], que sí sabe
  // manejar /sso-callback) en vez de perderse en una página que no
  // tiene nada que ver con el login.
  if (
    req.nextUrl.pathname.endsWith("/sso-callback") &&
    !req.nextUrl.pathname.startsWith("/sign-in") &&
    !req.nextUrl.pathname.startsWith("/sign-up")
  ) {
    const destino = new URL("/sign-in/sso-callback", req.url);
    destino.search = req.nextUrl.search;
    return NextResponse.redirect(destino);
  }

  peticionesDesdeLimpieza += 1;
  if (peticionesDesdeLimpieza >= 500) {
    peticionesDesdeLimpieza = 0;
    limpiarVencidos(contadorPorIp, VENTANA_MS);
    limpiarVencidos(contadorPorUsuario, VENTANA_MS);
    limpiarVencidos(contadorWebhooksMl, VENTANA_MS);
  }

  // El límite por IP corre ANTES que cualquier chequeo de sesión —
  // igual que antes del fix de 2026-10-21, a propósito: un 429 nunca
  // debe depender de si Clerk pudo o no resolver la sesión. El webhook
  // de Mercado Libre usa su propia cuenta, más generosa (ver arriba) —
  // nunca la de un usuario normal.
  if (req.nextUrl.pathname === RUTA_WEBHOOKS_ML) {
    if (superaLimite(contadorWebhooksMl, ipDeLaPeticion(req), LIMITE_WEBHOOKS_ML, VENTANA_MS)) {
      return new NextResponse("Demasiadas peticiones — espera un minuto.", { status: 429 });
    }
  } else if (superaLimite(contadorPorIp, ipDeLaPeticion(req), LIMITE_POR_IP, VENTANA_MS)) {
    return new NextResponse("Demasiadas peticiones desde esta red — espera un minuto.", { status: 429 });
  }

  const sesion = await auth();

  // Fix real (2026-10-21) — acá antes había `await auth.protect()`.
  // Nunca más: para una ruta no pública sin sesión, `auth.protect()`
  // intenta un rewrite al handshake de Clerk que, detrás del proxy de
  // Railway, se cuelga ~30s y termina en 500 (ver
  // lib/rutas-publicas.ts para el diagnóstico completo, con el issue
  // real de Clerk). Se reemplaza por el chequeo explícito de abajo,
  // que nunca depende de ese mecanismo: un 401 inmediato para `/api/*`
  // (una API nunca necesita el handshake de navegador), o un redirect
  // directo a `/sign-in` para una página — ambos caminos responden en
  // milisegundos, con o sin `Accept: text/html`.
  if (!sesion.userId && !esRutaPublica(req)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "no_autenticado" }, { status: 401 });
    }
    // req.url (en vez de la base pública real) ya dio el mismo bug que
    // forzó RAILWAY_PUBLIC_DOMAIN en lib/url-publica.ts (tarea 1.12):
    // detrás del proxy de Railway, el host que arma Next puede no ser
    // el dominio público real. No se reusa urlPublicaBase() tal cual
    // (depende de next/headers, que no funciona en el runtime del
    // middleware, otra etapa previa a los Route Handlers/Server
    // Components) — se recalcula el mismo criterio acá, directo contra
    // el request del middleware, que ya trae sus propias cabeceras.
    return sesion.redirectToSignIn({ returnBackUrl: `${urlPublicaBaseDesdeMiddleware(req)}${req.nextUrl.pathname}${req.nextUrl.search}` });
  }

  if (sesion.userId && superaLimite(contadorPorUsuario, sesion.userId, LIMITE_POR_USUARIO, VENTANA_MS)) {
    return new NextResponse("Demasiadas peticiones de tu cuenta — espera un minuto.", { status: 429 });
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
