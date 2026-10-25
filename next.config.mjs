// Tarea 1.10 — el dominio de Clerk para la CSP (abajo) nunca se
// escribe a mano: una llave pública de Clerk es
// "pk_(test|live)_" + base64(dominio-del-frontend-api + "$"). Si algún
// día cambia de llave de Development a Production (pendiente real, ver
// memoria "Clerk MFA cuesta en Production"), la CSP sigue correcta
// sola, sin que alguien se acuerde de venir a editar un dominio acá.
function dominioClerkDesdeLlavePublica(llave) {
  if (!llave) return null;
  const base64 = llave.split("_").pop();
  try {
    return Buffer.from(base64, "base64").toString("utf8").replace(/\$$/, "");
  } catch {
    return null;
  }
}

const dominioClerk = dominioClerkDesdeLlavePublica(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// Lista exacta que pide la documentación de Clerk para CSP propia
// (self-hosted, sin el nonce automático). @clerk/nextjs 6.39.x ya
// puede poner el nonce, pero no se activa en este cambio: una CSP mal
// armada no rompe el build, rompe el navegador, y login, 2FA y /cuenta
// con nonce todavía no se probaron en vivo. 'unsafe-inline' en
// script-src y style-src es lo que Clerk pide como mínimo hoy, no un
// atajo nuestro — y style-src además lo necesita toda la app, por los
// style={{...}} de React, que compilan a atributos style="" inline.
const cspClerk = dominioClerk
  ? [
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""} https://${dominioClerk} https://challenges.cloudflare.com https://*.protect.clerk.com`,
      `connect-src 'self' https://${dominioClerk} https://*.protect.clerk.com:*`,
      `style-src 'self' 'unsafe-inline'`,
      `frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com`,
      `worker-src 'self' blob:`,
    ]
  : [];

// Issue #235 — causa real de "columna FOTO siempre en '—'" en
// /panel/investigacion: NUNCA fue un selector roto en los lectores de
// la extensión (confirmado — ver extension/LEEME.md). El CSP global
// de esta app (tarea 1.10) solo permitía `img-src 'self' data:` + el
// dominio de Clerk — cualquier <img> apuntando a una foto real
// escaneada de un marketplace quedaba bloqueada por el NAVEGADOR
// antes de intentar siquiera la petición de red (nunca daba un error
// de red "normal" que se pudiera ver con onError — el navegador ni
// llegaba a pedirla). `img-src` está separado de `cspClerk` a
// propósito: son dominios de marketplaces, nada que ver con Clerk —
// tienen que seguir permitidos aunque algún día `dominioClerk` sea
// null (ej. en desarrollo local sin esas variables).
//
// Dominios reales, confirmados contra una captura real de cada sitio
// (Wayback Machine — listado.mercadolibre.com.co bloquea el acceso
// directo desde este sandbox, igual que en #229/#231/#233; esta fue
// la forma de conseguir HTML real sin inventar nada):
//   - Mercado Libre: http2.mlstatic.com (confirmado en un listado de
//     hoy, "zapatillas", el mismo <img class="poly-component__picture">
//     que ya lee mercadolibre.js) -> *.mlstatic.com (varios edges http1/http2/etc).
//   - Amazon: m.media-amazon.com (confirmado en el <img class="s-image">
//     real que ya lee amazon.js) -> *.media-amazon.com.
//   - Temu: img.kwcdn.com (confirmado en la home real) -> *.kwcdn.com.
//   - AliExpress: ae01.alicdn.com (confirmado en un listado real,
//     "shoes") y Alibaba: img.alicdn.com/i.alicdn.com (confirmado en
//     la home real) — mismo grupo corporativo, mismo dominio ->
//     *.alicdn.com cubre los dos.
//   - Shein: img.ltwebstatic.com (confirmado en la home real) -> *.ltwebstatic.com.
const IMG_SRC_CSP =
  "img-src 'self' data: https://img.clerk.com https://*.mlstatic.com https://*.media-amazon.com https://*.kwcdn.com https://*.alicdn.com https://*.ltwebstatic.com";

const csp = [
  "default-src 'self'",
  ...cspClerk,
  IMG_SRC_CSP,
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Issue #58 (Z-ML-09) — /panel/sku/importar sube un CSV de hasta 5 MB
  // (lib/importar-csv-skus.ts, TAMANO_MAXIMO_BYTES) a través de un
  // Server Action. El límite real de Next para el body de un Server
  // Action, si no se toca esto, es 1 MB (confirmado en
  // node_modules/next/dist/server/app-render/action-handler.js) — por
  // debajo del tope que pide el propio parser, así que un archivo
  // válido de 2-5 MB se rechazaría ANTES de llegar a nuestra
  // validación real, con un error genérico de Next en vez del mensaje
  // real del parser. 6 MB deja margen sobre el tope de 5 MB (el campo
  // oculto que reenvía el texto ya leído al confirmar agrega algo de
  // overhead de multipart/form-data).
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  // La app no usa next/image, no tiene carpeta public/ ni sharp. Igual
  // Next 14.2.35 registra /_next/image y, si la petición pasa la
  // validación de parámetros, entra a imageOptimizer (DoS del
  // optimizador y, si algún día se instala sharp, el RCE por AVIF).
  // Con unoptimized, handleNextImageRequest responde 404 antes de
  // llamar al optimizador — ver next/dist/server/next-server.js en
  // 14.2.35: `if (imagesConfig.loader !== 'default' || imagesConfig.unoptimized) render404`.
  images: { unoptimized: true },
  // Tarea 1.5 — le dicen a Clerk que use NUESTRAS páginas de login/
  // registro (app/sign-in, app/sign-up), no su pantalla genérica
  // alojada en accounts.dev. Bug real encontrado en vivo (14/10/2026):
  // sin esto, Clerk mandaba a la gente a su propio dominio para
  // iniciar sesión y, en modo "Development", no sabía cómo volver
  // después a nuestra app ("Clerk cannot redirect to your
  // application"). Son valores fijos (rutas propias, no secretos), por
  // eso van acá y no como variable de Railway.
  env: {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/",
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/",
  },
  // Fix middleware (2026-10-21) — "/login" no existe como página (la
  // real es "/sign-in"), pero cualquiera que le pegue de todos modos
  // (un link viejo, un bookmark) antes caía en el mismo bug del
  // middleware (ver lib/rutas-publicas.ts): sin sesión y sin
  // `Accept: text/html`, se colgaba 30s y terminaba en 500. Los
  // redirects de next.config.js corren ANTES que el middleware
  // (orden real documentado por Next.js: headers → redirects →
  // middleware → rutas), así que esto nunca llega a pasar por ahí.
  // "/registro" no se agrega: no se usa en ningún lado del código hoy
  // (confirmado con `git grep`), agregar un redirect sin uso real
  // sería adivinar.
  async redirects() {
    return [{ source: "/login", destination: "/sign-in", permanent: false }];
  },
  // Tarea 1.10 — blindaje web. Pendiente real antes de dar esto por
  // cerrado del todo: probar en vivo registro, login, 2FA y /cuenta
  // con esta CSP activa — una CSP mal armada no rompe el build, rompe
  // el navegador de quien la usa, y eso solo se ve probándolo.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
