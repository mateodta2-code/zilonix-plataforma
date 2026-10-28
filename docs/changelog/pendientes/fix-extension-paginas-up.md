- **2026-10-27** — issue #251 (smoke de Mateo, ext 0.3.35): en una ficha "user product" de Mercado Libre (`/up/MCOU…`, ej. "Cojín antiescaras lumbar coxis ortopédico hemorroides") el panel de la extensión no aparecía — silencio total, sin error visible.

  **1. Causa real**: `tipoDePagina` (`extension/lectores/mercadolibre.js`) solo reconocía `/(p/)?MCO-?\d+` y `articulo.*` — "MCOU…" no es "MCO" + dígitos (la "U" rompe el match), así que devolvía `null` y `reescanear()` (`content.js`) salía sin dibujar nada. Se suma un patrón nuevo (`/up/(?:MCO|MLA|...)U\d+`, los mismos 7 países de `PREFIJO_ITEM_ML`) que reconoce la FORMA de la URL — nunca decide el id a partir de ahí, eso es el punto 2.

  **2. El itemId real NUNCA es el MCOU del path**: esa numeración es de variante/selector, no de publicación (mismo criterio que ya documentaba `clasificarLinkListadoMl` para tarjetas de listado — "user_product" sin itemId). El id real viaja en el query string: `wid=MCO…` (prioridad 1) o `pdp_filters=item_id:MCO…` (prioridad 2, con el ":" codificado `%3A` en la URL real — se decodifica antes de buscar). Nueva función pura `extraerWidDeUrl` (+ `esPaginaUserProduct`), usada en `leerProducto` SOLO cuando la URL es `/up/` (el resto de fichas sigue con `extraerIdDeUrl`, sin cambios). Sin wid ni pdp_filters → `itemId` queda `null`, nunca se inventa a partir del MCOU.
    - Bug real encontrado AL PROBAR esto: la primera versión de `extraerWidDeUrl` usaba un solo grupo de captura `(MCO|MLA|...\d+)` — el `\d+` solo se ataba a la ÚLTIMA alternativa (MPE), así que "wid=MCO1742001365" devolvía el string truncado `"MCO"`. Corregido con 2 grupos de captura separados (prefijo, dígitos), el mismo patrón que ya usaba `extraerIdDeUrl` — verificado con las 3 URLs reales del smoke antes y después del fix.
  - Una vez que `itemId` es el wid real, la antigüedad se interpola como **"item"** (nunca "product" — confirmado: `tipoIdDePagina()` en `content.js` ya caía a "item" por default para cualquier URL sin `/p/`, incluida `/up/`, sin necesitar ningún caso nuevo — solo se documentó con un comentario).

  **3. Caso real de referencia (panel de Selltrix, mismo competidor que ya estima antigüedad por id)** — los 3 wid del smoke YA son puntos reales de `PUNTOS_CALIBRACION_ID_FECHA` (sin interpolar, fecha exacta calibrada):
    - Coliplus, wid `MCO1742001365` → **330 días** (Selltrix: ≈330 d)
    - cobija, wid `MCO1836584643` → **250 días** (Selltrix: ≈250 d)
    - Rtafull x2, wid `MCO1333873907` (vía `pdp_filters`) → **1179 días** (Selltrix: ≈1179 d)

  **4. Revisión del resto del panel** (pedido explícito de la tarea — "nada más asuma /p/ o MCO-"):
    - `construirLinkSeguirProducto`/`linkSeguir`: valida `PREFIJO+dígitos` contra `itemIdActual` — ya correcto una vez que `itemIdActual` es el wid real, sin cambios.
    - `enviarVendidosAZilonix`/`enviarInventarioFichaAZilonix` (`content.js`): solo chequean `typeof datos.itemId === "string"` — genéricas, sin ningún supuesto de `/p/` o `MCO-`, sin cambios.
    - `esCatalogo` (`tieneBuybox`): depende de selectores DOM (`.ui-pdp-buybox__highlight`, `.ui-pdp-seller__header`), no de la forma de la URL — sin cambios.
    - "Antigüedad" en el panel: cuando no hay `wid`/`pdp_filters`/`date_created` confirmado, ahora dice explícitamente **"Sin dato (falta antigüedad)"** (antes, "Sin dato" bare) — el bloque entero (`bloqueAnalisisAproximado`) sigue dibujándose siempre, nunca se oculta (ya era así desde el fix de #251 "aproximados siempre visibles").

  **5. Extensión subida a 0.3.36** (`extension/version.json` + `manifest.json`). `calibracion-aproximados.json` sin cambios en esta rama — no hizo falta regenerar `extension/calibracion-aproximados.js`.

  **Tests nuevos** (`extension/lectores/mercadolibre.test.ts`): `tipoDePagina` con las 3 URLs reales del smoke + una de otro país → "producto"; `esPaginaUserProduct`/`extraerWidDeUrl` con las 3 URLs (wid y pdp_filters) + el caso sin wid/filtro → `null`, nunca el MCOU; y un describe de pipeline completo URL → itemId → antigüedad con la tabla de calibración REAL ya comiteada, confirmando los 3 días de arriba (±3).

  Sin migraciones. `extension/` tocada (avisado antes, para el diario). Sin PR (a pedido). Sin tokens de ML, sin llamadas a Mercado Libre.

  Refs #251
