- **2026-10-31** — tras iniciar sesión (Google o correo) o registrarse, el destino por defecto ahora es `/panel`, no `/` (la portada pública, que mostraba los botones "Ver mi cuenta"/"Ir al panel" en vez de entrar directo).

  **`next.config.mjs`** — `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`/`..._SIGN_UP_...` pasan de `/` a `/panel`. Son "FALLBACK", no "FORCE": un `?redirect_url=...` explícito (ej. volver a `/panel/pedidos/...` tras una invitación, `app/invitacion/[token]/page.tsx`) sigue ganando solo, Clerk nunca lo pisa.

  **`app/page.tsx`** — con sesión, `/` ya no se pinta: `redirect("/panel")` desde el servidor (`next/navigation`) apenas se resuelve `obtenerOCrearUsuarioActual()`, antes de cualquier JSX — sin parpadeo. Se quita el bloque `<SignedIn>` (botones "Ver mi cuenta"/"Ir al panel"/"Crear mi empresa" y la lectura de `listarEmpresasDeUsuario`, que ya no hace falta acá): `/panel` decide solo el destino final (`/crear-empresa` si la empresa no existe todavía, `/sign-in` si la sesión no resultó válida — `lib/panel-contexto.ts`, sin duplicar esa lógica). Sin sesión, `/` sigue mostrando la portada pública de siempre, con el aviso de `?salida=cuenta-borrada(-soporte)` intacto.

  **`app/page.test.tsx`** (nuevo, no existía prueba para esta página): con sesión, `HomePage()` redirige a `/panel` sin llegar a pintar nada; sin sesión, pinta la portada pública ("Iniciar sesión"/"Crear cuenta") y el aviso de salida cuando corresponde.

  **No se tocó**: `components/marco/BotonCerrarSesion.tsx` (`signOut({ redirectUrl: "/" })` sigue llevando a `/`), `middleware.ts`, `extension/`, `lib/ml/cliente.ts`, `db/schema.ts`. Ninguna migración. Ninguna versión de `@clerk/*` ni de `next`.

  Verificado: `npx vitest run app/page.test.tsx` (3 pruebas nuevas, verde), `npx vitest run middleware.test.ts` y `npx vitest run scripts/verificar-permisos.test.ts` sin regresión, `npm run typecheck` en verde.
