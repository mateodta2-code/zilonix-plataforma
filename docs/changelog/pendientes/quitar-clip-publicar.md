- **2026-11-11** — se quita por completo de la interfaz de `/panel/publicar` la tarjeta "PUBLICAR CLIP (VIDEO)" (pestañas Desde el computador, Desde un link, Reusar de mis cuentas, Desde la extensión, Desde Canva, campo de video, SKU y el botón "Subir Clip a cuenta(s)"). Mercado Libre bloquea la subida de Clips por API para ítems locales (403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`, ver `mateo/clip-ruta-local-1`) — esa sección nunca llegaba a funcionar para un vendedor local.

  **1. `app/panel/publicar/PaginaPublicar.tsx` / `app/panel/publicar/page.tsx`**: se quita el render de `<SeccionClip>` y la bandera `clipHabilitado` (prop + `process.env.CLIP_HABILITADO`), que ya no tenían ningún consumidor.

  **2. Se borran** `app/panel/publicar/SeccionClip.tsx` y los 7 helpers de UI que solo ella usaba (`app/panel/publicar/clip/{estado-moderacion,leerMetadatosVideo,mensajes-error,razon-no-subir,recibir-mensaje-extension,tipos-cliente,validacion-video-cliente}.ts`, con sus tests) — nada de esto se reutilizaba en ningún otro lado del repo.

  **3. Se mantienen intactos** (por diseño, nunca se tocan): `lib/ml/clip.ts`, todas las rutas `app/api/ml/clip/**` y `lib/trabajos/subirClipMultiCuenta.ts` — el código server-side de Clip sigue ahí, solo deja de llamarse desde esta interfaz.

  **4. `app/panel/publicar/clip/page.tsx`**: sigue existiendo como redirect a `/panel/publicar` por compatibilidad con un link/bookmark viejo — se le quita el ancla `#clip` (ya no apunta a nada, el `<div id="clip">` se borró con `SeccionClip.tsx`). `scripts/verificar-permisos.test.ts` actualizado con el mismo motivo.

  **Extensión de Chrome**: el botón "Importar video a Clip" (7 plataformas, incluida TikTok) se retira en una rama/PR aparte (`quitar-clip-extension`), por el alcance y la reinstalación completa que exige tocar `extension/`.

  Sin migración. Sin cambios de versión en `next`/`react`/`@clerk/*`/`drizzle`.

  Verificado: `npm run typecheck` en verde. `npx vitest run scripts/verificar-permisos.test.ts app/panel/publicar/ app/api/ml/clip/ lib/ml/clip.test.ts` — todo en verde salvo las pruebas de `clip.test.ts` que necesitan Postgres real (ambiental, sin DB en este sandbox). `npm test` completo corrido una vez: mismo patrón de fallos ambientales por falta de `DATABASE_URL_APP` ya documentado en otras ramas — ninguno nuevo ni relacionado con este cambio.
