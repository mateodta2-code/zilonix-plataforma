import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Tarea 1.5 — toda ruta cerrada por defecto (regla de CLAUDE.md), salvo
// las que se listan acá explícitamente. Mismo criterio que ya usa
// Zilonix OS: la excepción se justifica, nunca por omisión.
const esRutaPublica = createRouteMatcher([
  "/",
  "/api/version",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!esRutaPublica(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
