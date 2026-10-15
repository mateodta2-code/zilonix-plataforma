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
// (self-hosted, sin el nonce automático — eso exige una versión de
// @clerk/nextjs más nueva que la 6.9.6 de este repo). 'unsafe-inline'
// en script-src y style-src es lo que Clerk pide como mínimo hoy, no
// un atajo nuestro — y style-src además lo necesita toda la app, por
// los style={{...}} de React, que compilan a atributos style=""
// inline.
const cspClerk = dominioClerk
  ? [
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""} https://${dominioClerk} https://challenges.cloudflare.com https://*.protect.clerk.com`,
      `connect-src 'self' https://${dominioClerk} https://*.protect.clerk.com:*`,
      `img-src 'self' data: https://img.clerk.com`,
      `style-src 'self' 'unsafe-inline'`,
      `frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com`,
      `worker-src 'self' blob:`,
    ]
  : [];

const csp = [
  "default-src 'self'",
  ...cspClerk,
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
