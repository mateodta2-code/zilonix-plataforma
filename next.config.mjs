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
};

export default nextConfig;
