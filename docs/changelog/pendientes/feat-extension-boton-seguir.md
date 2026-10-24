- **2026-10-24** — issue #174: botón **"Seguir en Zilonix"** en el panel de la extensión, en Mercado Libre.

  **`extension/config.js` (nuevo)**: `URL_APP`, la URL base de Zilonix Seller — hoy la de producción real (`web-production-af270.up.railway.app`, confirmada en `docs/CHANGELOG.md`, tarea 2.1), con la de staging comentada justo abajo para probar antes de repartir una versión nueva. Un solo lugar para esta URL, nunca repetida a mano.

  **`extension/lectores/mercadolibre.js`:**
  - En una página de **producto**: el botón abre, SOLO por ese clic (nunca solo al leer la página), una pestaña nueva a `<URL_APP>/panel/investigacion/seguimiento?agregar=<itemId>` — el mismo `itemId` que ya se usa para "vendidos exacto" (issue #174 anterior), validado otra vez con `/^MCO\d+$/` antes de armar el link (`construirLinkSeguirProducto`).
  - En una página de **tienda o vendedor** (nuevo tipo de página, `tipoDePagina` reconoce `/perfil/`, `tienda.mercadolibre` y `?CustId=`): el botón dice "Seguir tienda en Zilonix" y apunta a `?agregar_tienda=<sellerId>`, validado con `/^\d+$/` (`construirLinkSeguirTienda`). El `sellerId` se lee del HTML incrustado (`"seller_id"`/`"user_id"`, texto plano — a diferencia de "vendidos", una página de tienda es de UN solo vendedor, no hay otro con el que confundirse) — si no se puede confirmar, el panel muestra "No se pudo confirmar el vendedor de esta página" y nunca ofrece el botón, nunca inventa un id.
  - Los dos constructores de link usan `encodeURIComponent` y devuelven `null` ante cualquier id que no pase su patrón — nunca arman una URL con algo sin validar.

  **`extension/content.js`:** nuevo `agregarBotonSeguir` — construido por completo con `createElement`/`textContent` (nunca `innerHTML`), la URL nunca se escribe en el DOM como atributo ni texto, solo vive en la clausura de JS que llama a `window.open(url, "_blank", "noopener,noreferrer")` al hacer clic. `renderizarProducto` lo agrega cuando `datos.linkSeguir` viene de Mercado Libre (`undefined` en los otros 5 sitios — nunca aparece ahí). Nuevo `renderizarTienda` para el panel mínimo de una página de vendedor.

  **`extension/manifest.json`:** `config.js` se carga solo en el `content_scripts` de Mercado Libre (antes de `lectores/mercadolibre.js`) — los otros 5 sitios no lo necesitan, no se tocan.

  **Sin permisos nuevos, sin peticiones de red**: `window.open` de una pestaña nueva no pide ningún permiso de manifest adicional; nada de esto llama a `fetch` en ningún momento.

  **Pruebas nuevas** (`extension/lectores/mercadolibre.test.ts`): `construirLinkSeguirProducto`/`construirLinkSeguirTienda` con id válido (link armado exacto) y una lista de ids inválidos (con guión, con letras de más, vacío, intento de inyección, `null`/`undefined`) que nunca arman nada; `leerSellerIdDeTienda` con `seller_id` entre comillas, `user_id` numérico sin comillas, y sin ningún dato.

  **Versión**: `extension/version.json` y `extension/manifest.json` 0.2.1 → 0.3.0.

  **No se tocó**: `db/`, ninguna migración, `docs/CHANGELOG.md`, la versión de `package.json`.

  Verificado: `npm run typecheck` en verde. `npm test` en verde (413 pruebas, mismo baseline conocido de `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`, sin regresión). `npm run extension:zip` corrido en local con la versión nueva.
