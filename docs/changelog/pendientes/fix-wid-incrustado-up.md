- **2026-10-28** — issue #251 (smoke de Mateo, ext 0.3.37): en `https://www.mercadolibre.com.co/almohada-cojin-dona-para-hemorroides-coxis/up/MCOU2401140163?quantity=6` (SIN `wid` ni `pdp_filters` en la URL — solo `quantity`) el panel salía, "Vendidos estimados" daba bien (2200, no necesita itemId), pero **Antigüedad** quedaba en "Sin dato (falta antigüedad)" y Ventas/mes y Facturación/mes en "Sin dato". Con `wid` en la URL, la misma ficha daba 41 m (Selltrix: 3.6 a).

  **Causa**: `extraerWidDeUrl` (del fix anterior, #270) solo mira `wid=`/`pdp_filters=item_id:` en la URL — cuando ninguno de los dos está presente, `itemIdActual` quedaba `null` y toda la cadena que depende de él (`antiguedadDias`) se queda sin nada contra qué interpolar.

  **Arreglo**: nueva función pura `extraerIdIncrustadoConfiable(html)` — último recurso, SOLO cuando `wid`/`pdp_filters` no dieron nada. Saca el itemId real de 3 marcadores que CUALQUIER página de producto real declara de forma autorreferencial a sí misma (convención SEO/Open Graph estándar, no un detalle interno de Mercado Libre — por eso no hace falta confirmarlos contra una captura puntual):
    1. `<link rel="canonical" href="...">`
    2. `<meta property="og:url" content="...">`
    3. JSON-LD (`<script type="application/ld+json">`) con `"@type":"Product"` — su `productID`/`sku`/`@id`/`url`.

  **Nunca confunde con un producto recomendado**: estas 3 fuentes son SIEMPRE sobre la página actual, nunca sobre una tarjeta del carrusel de "productos relacionados" — a propósito nunca se usa `__NORDIC_RENDERING_CTX__` acá (ese JSON trae el item actual Y los recomendados mezclados, sin ningún campo de nivel superior confirmado que diga "este es el que se está viendo" — usarlo sin un itemId ya conocido para amarrar sería adivinar, el mismo riesgo que ya evita `leerDatosIncrustados` en todo este archivo). Si las 3 fuentes DISCREPAN entre sí, o si hay más de un JSON-LD `"Product"` con ids distintos y ninguna otra fuente que desempate, nunca se elige ninguno a ciegas: `null`.

  **Orden final**: `wid` de la URL → `pdp_filters` → incrustado confiable → `null` (`extraerWidDeUrl(url) || extraerIdIncrustadoConfiable(html)` en `leerProducto`) — los dos primeros, sin cambios, ya los prueba `extraerWidDeUrl` en ese orden.

  **Extensión subida a 0.3.38** (avisado antes de tocar `extension/`).

  **Tests nuevos** (`extension/lectores/mercadolibre.test.ts`): `extraerIdIncrustadoConfiable` con canonical solo, og:url solo, JSON-LD solo (productID/sku/url), con productos recomendados presentes en la misma página (nunca los confunde), sin ningún marcador (null), canonical y og:url en desacuerdo (null), 2 JSON-LD "Product" con ids distintos sin desempate (null) y CON desempate por canonical, un JSON-LD que no es "Product" (ignorado), y un JSON-LD cortado (se ignora ese bloque, nunca revienta). Más un describe del orden completo wid → pdp_filters → incrustado → null, con el caso real exacto de la tarea (`/up/MCOU2401140163?quantity=6`).

  Sin migraciones. `extension/` tocada (avisado antes). Sin PR (a pedido). Sin tokens de ML, sin llamadas a Mercado Libre.

  Refs #251
