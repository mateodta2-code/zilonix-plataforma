- **2026-11-11** — se retira de la extensión de Chrome el botón "Importar video a Clip" (7 plataformas: Mercado Libre, Amazon, Temu, AliExpress, Alibaba, Shein y TikTok). Continuación de `quitar-clip-publicar` (quita la tarjeta de Clip de `/panel/publicar`): Mercado Libre bloquea la subida de Clips por API para ítems locales, así que este botón de la extensión tampoco llegaba a ningún lado útil. **Requiere reinstalación completa de la extensión** (manifest `0.3.41` → `0.3.42`).

  **1. Los 5 lectores de marketplace sin precio/vendidos vía video** (`extension/lectores/{amazon,temu,aliexpress,alibaba,shein}.js`): se quita `leerVideoDesdeHtml`/`leerVideo`, el `require("./video-comun.js")` y su `module.exports` — vuelven a ser lectores sin ningún test propio (como antes de issue #44), ya no exponen nada por `leerVideo`.

  **2. `extension/lectores/mercadolibre.js`**: mismo retiro de `leerVideoDesdeHtml`/`leerVideo` (y el `require` de video-comun), sin tocar el resto del lector (precio/vendidos/listado/tienda/reseñas siguen intactos).

  **3. Se borran por completo** `extension/lectores/video-comun.js` (núcleo compartido de extracción de video) y `extension/lectores/tiktok.js` — TikTok existía únicamente para este botón (no investiga precio/vendidos), así que se quita también el `content_script`/`web_accessible_resources` de `*://*.tiktok.com/*` en `manifest.json`.

  **4. `extension/content.js`**: se quitan `agregarBotonImportarVideo` y `renderizarVideo` (el panel mínimo que solo existía para TikTok), y la lectura de `resultadoVideo` dentro del flujo de página de producto.

  **5. `extension/background.js`**: se quita el manejador del mensaje `"zilonix:importar-video"` y la carga de `video-comun.js` (`importScripts`/`require`) que solo servía para revalidar esa URL. `"zilonix:importar-publicar"` (el mecanismo genérico de abrir/enfocar Publicar) queda intacto. Se agrega un `module.exports = {}` vacío al final (mismo patrón dual que `content.js`/`marcador-zilonix.js`) porque, sin ningún `require()` real, `tsc` dejaba de reconocer el archivo como CommonJS para el `import()` dinámico de `background.test.ts` (TS2306).

  **6. `extension/marcador-zilonix.js`**: se quita la entrada `"zilonix:importar-video"` de `TIPOS_REENVIADOS` y del set `TIPOS_QUE_NECESITAN_ACK_PUBLICAR` (vuelve a tener un solo elemento).

  **7. `extension/panel.css`**: se quita `.zx-lista-videos` (solo la usaba el botón retirado).

  **8. `extension/LEEME.md`**: se borra la sección "Importar video a Clip" completa y se actualizan las menciones del resumen de arriba (de "ocho puentes" a "siete").

  Tests borrados por completo (solo probaban este feature): `amazon.test.ts`, `temu.test.ts`, `aliexpress.test.ts`, `alibaba.test.ts`, `shein.test.ts`, `tiktok.test.ts`, `video-comun.test.ts`. Tests recortados (se quita solo el describe/import de video, el resto queda intacto): `mercadolibre.test.ts`, `background.test.ts`, `marcador-zilonix.test.ts`.

  Sin migración. Sin cambios de versión en `next`/`react`/`@clerk/*`/`drizzle`.

  Verificado: `npm run typecheck` en verde. `npx vitest run extension/` — 271 pruebas en verde. `npm test` completo corrido una vez: mismo patrón de fallos ambientales por falta de `DATABASE_URL_APP` ya documentado en otras ramas — ninguno nuevo ni relacionado con `extension/`.

  **Pendiente para Mateo**: avisar a cada usuario de la extensión que debe reinstalarla completa (nunca alcanza con "Recargar") — bajar el ZIP nuevo solo después de confirmar que `extension/version.json`/`version.json` servido ya muestra `0.3.42`.
