- **2026-10-24** — issue #174, corrección real sobre "Seguir tienda en Zilonix": `leerSellerIdDeTienda` usaba `user_id` como respaldo cuando no encontraba `seller_id` en el HTML incrustado — pero en una página de tienda de Mercado Libre, `user_id` suele ser el de la PERSONA con sesión iniciada en el navegador (si hay una), no el del vendedor de esa tienda. Con ese respaldo, el botón podía mandar a seguir al usuario equivocado en vez de al vendedor real.

  **`extension/lectores/mercadolibre.js`:** se quita por completo el respaldo con `user_id` — `leerSellerIdDeTienda` ahora solo acepta `seller_id`. Nueva `extraerCustIdDeUrl(url)`: si la URL de la página trae `?CustId=<dígitos>` (la forma clásica de "visitar vendedor" de Mercado Libre), se usa ESE id primero — viene directo de la URL, nada que leer ni adivinar del HTML. Sin `CustId` en la URL y sin `seller_id` en el HTML, devuelve `null` — el panel ya avisa "No se pudo confirmar el vendedor de esta página" y no ofrece el botón, nunca inventa un id.

  **Pruebas actualizadas** (`extension/lectores/mercadolibre.test.ts`): un HTML con SOLO `user_id` (sin `seller_id`) ya nunca da un id; `?CustId=` en la URL se usa incluso cuando el HTML trae un `seller_id` distinto; sin ninguno de los dos, `null`. Nueva `extraerCustIdDeUrl` probada sola/junto con otros parámetros de query, y sin el parámetro.

  **Versión**: `extension/version.json` y `extension/manifest.json` 0.3.0 → 0.3.1.

  **No se tocó**: `db/`, ninguna migración, `docs/CHANGELOG.md`, la versión de `package.json`.

  Verificado: `npm run typecheck` en verde. `npm test` en verde (mismo baseline conocido de `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`, sin regresión).
