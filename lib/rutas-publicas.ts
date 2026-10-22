import { createRouteMatcher } from "@clerk/nextjs/server";

// Fix real (2026-10-21) — antes esta lista vivía inline en
// middleware.ts. Se saca a su propio archivo para poder probarla sola
// (scripts/verificar-permisos.test.ts la importa para comprobar que
// coincide con RUTAS_EXENTAS — ver esa prueba) sin tener que levantar
// todo `clerkMiddleware`.
//
// "Pública" acá significa una sola cosa puntual: el middleware NO le
// exige una sesión de Clerk a esta ruta. Nunca significa "sin ningún
// control" — cada ruta de máquina de la lista se autentica con su
// propio mecanismo, documentado al lado.
//
// Bug real que motivó este archivo: con @clerk/nextjs 6.9.6, para una
// petición SIN sesión que además no es de documento (sin
// `Accept: text/html` — el perfil exacto de un webhook, un cron o un
// reintento sin navegador), `auth.protect()` intenta un rewrite a una
// URL absoluta de Clerk (`https://<host>/clerk_<timestamp>`) para
// negociar el handshake. Detrás del proxy de Railway, Next trata ese
// rewrite como si fuera a un host externo y se queda esperando hasta
// agotar el tiempo — confirmado con curl contra staging: 500 a los
// ~30,1s, con `x-clerk-auth-reason: protect-rewrite` y
// `x-middleware-rewrite: https://.../clerk_<timestamp>`. Issue real,
// mismo síntoma, reportado contra Clerk:
// https://github.com/clerk/javascript/issues/3864 (persiste incluso en
// versiones más nuevas de @clerk/nextjs — no se corrige subiendo la
// versión, hay que dejar de depender de `auth.protect()` para esto,
// que es justo lo que hace middleware.ts ahora).
//
// Antes de esta corrección, `/api/ml/webhooks` y `/api/ml/trabajador`
// ya estaban declaradas exentas de permisos de módulo en
// `scripts/verificar-permisos.test.ts` (RUTAS_EXENTAS) pero NO estaban
// en esta lista — el middleware las protegía igual con
// `auth.protect()`, y por eso Mercado Libre y el cron del trabajador
// se colgaban 30s y recibían 500 en vez del 200/401 rápido que
// esperan. Esa es la incoherencia real que esta lista cierra.
export const PATRONES_RUTAS_PUBLICAS = [
  "/",
  "/api/version",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Tarea 1.7 — quien recibe una invitación por correo todavía no
  // tiene sesión (puede ni tener cuenta). La propia página valida el
  // token contra la base (lib/invitaciones.ts) — el permiso real es
  // ese token, no el middleware.
  "/invitacion(.*)",

  // Mercado Libre llama esta ruta directo, sin sesión de usuario, y
  // espera un 200 RÁPIDO (si no le llega a tiempo, reintenta y puede
  // acabar desactivando el callback). Nunca confía en el contenido: el
  // propio handler (app/api/ml/webhooks/route.ts) valida la forma del
  // cuerpo, que `application_id` sea el nuestro (`ML_CLIENT_ID`) y
  // limita el tamaño del cuerpo antes de leerlo.
  "/api/ml/webhooks",

  // La llama el cron de .github/workflows/trabajador-avisos-ml.yml,
  // sin sesión de usuario. Se autentica con el secreto compartido
  // `x-trabajador-secret` (comparado con `crypto.timingSafeEqual` en
  // app/api/ml/trabajador/route.ts, nunca con `===` ni dejando pasar
  // una cabecera vacía).
  "/api/ml/trabajador",

  // La abre el NAVEGADOR del vendedor al volver del OAuth de Mercado
  // Libre. En el uso real siempre trae `Accept: text/html` (no debería
  // disparar el bug de arriba), pero se deja pública a propósito para
  // que ninguna petición rara a esta URL exacta (sin esas cabeceras,
  // sin sesión) se quede colgada 30s. Decisión documentada: se
  // autentica con DOS mecanismos propios, no con `auth.protect()` del
  // middleware — (1) `state` + PKCE (lib/ml/pkce-cookie.ts: un
  // `code_verifier` de un solo uso, nunca guardado en la base); (2) el
  // propio handler sigue exigiendo una sesión real de Clerk
  // (`obtenerOCrearUsuarioActual()`, redirige a `/sign-in` si falta) y
  // el permiso real (`requierePermiso("configuracion","crear")`, lanza
  // `SinPermisoError` si falta) antes de guardar nada. Por eso sigue
  // en RUTAS_PROTEGIDAS en scripts/verificar-permisos.test.ts — dejar
  // de depender del middleware para la sesión no significa dejar de
  // exigirla, solo deja de exigirla con un mecanismo que se cuelga.
  "/api/ml/callback",
];

export const esRutaPublica = createRouteMatcher(PATRONES_RUTAS_PUBLICAS);
