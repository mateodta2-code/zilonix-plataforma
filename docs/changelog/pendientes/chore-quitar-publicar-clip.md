- **chore-quitar-publicar-clip** — Se retira por completo el módulo "Publicar Clip (video)" de `/panel/publicar` (pedido de Mateo, 2026-11-12).

  **Borrado**: `app/panel/publicar/SeccionClip.tsx`, todo `app/panel/publicar/clip/` (menos `page.tsx`), las 6 rutas de `app/api/ml/clip/`, `lib/trabajos/subirClipMultiCuenta.ts`, `lib/trabajos/videoTemporalClip.ts`, `lib/ml/recibir-multipart-video.ts`, `lib/ml/video-externo.ts`, `lib/ml/video-magic-bytes.ts` (cada uno con su prueba). En `lib/ml/cliente.ts` salen `subirClipMl`, `obtenerClipsMl` y `TIMEOUT_SUBIDA_CLIP_MS`; en `lib/ml/publicar-reglas.ts`, `clipRequierePermisoDeApp`. La bandera `CLIP_HABILITADO` ya no se lee en ningún lado.

  **Se conserva**: `buscarItemPorSku` (la usa "Importar por SKU propio") — se movió de `lib/ml/clip.ts` a `lib/ml/buscar-item-por-sku.ts`, con sus 4 pruebas. `lib/seguridad/ssrf.ts` y `lib/concurrencia.ts` siguen (los usan Canva, IA y Promociones). `/panel/publicar/clip` queda como redirect a `/panel/publicar` para no romper links viejos; `scripts/verificar-permisos.test.ts` actualizado (5 rutas protegidas menos, motivo de la exención reescrito).

  Sin migraciones. `extension/` sin tocar: su botón "Importar video a Clip" ahora abre `/panel/publicar` sin sección de Clip — quitarlo de la extensión exige reinstalación de cada usuario, se deja para un PR aparte si se decide.

  Después del merge (opcional): borrar la variable `CLIP_HABILITADO` del servicio `web` en staging y producción — ya no tiene efecto.

  Verificado: `npm run typecheck` en verde; `npx vitest run lib/ml/cliente.test.ts lib/ml/publicar-reglas.test.ts scripts/verificar-permisos.test.ts app/panel/publicar` — 542 pruebas en verde; `npm run build` en verde (con los valores ficticios del CI). `lib/ml/buscar-item-por-sku.test.ts` necesita Postgres real — queda para el CI.
