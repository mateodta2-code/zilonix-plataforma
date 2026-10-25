- **2026-10-25** — issue #241 (Refs), cuarto intento de Full ML. El selector de #239 (`svg[aria-label="FULL" i]`), aunque confirmado contra una captura real de Wayback Machine, no matcheó en el navegador real cuando Sharel lo probó con la extensión 0.3.14 en staging: "% FULL" seguía en 0%.

  **Causa real más probable, documentada en vez de adivinada de nuevo**: Wayback captura el HTML que el SERVIDOR mandó — el listado de Mercado Libre es una SPA que hidrata/re-renderiza del lado del cliente, y esa hidratación puede cambiar cómo queda armado el `<svg>` del ícono sin que el HTML "servido" (lo único que Wayback puede capturar) haya cambiado. Un selector CSS exacto, confirmado solo contra HTML servido, puede dejar de matchear en el DOM real por esto.

  **Se abandona el selector CSS único** a favor de una función pura (`detectarFullEnHtmlTarjeta`, `extension/lectores/mercadolibre.js` — string de HTML → boolean, mismo criterio que `clasificarLinkListadoMl` de #233) que se puede probar con un fixture real en vitest. Recibe `tarjeta.outerHTML` y prueba, en capas, siempre acotado al bloque de envío real (`poly-component__shipped-from`/`poly-component__shipping` — nunca "full" suelto en toda la tarjeta, un título real puede decir "Full HD" o "Full Pack"):
  1. `aria-label="FULL"` en cualquier elemento del bloque (lo que confirmó #239).
  2. `<use href="#poly_full">` o `xlink:href` (forma vieja del atributo SVG) — el sprite real que ya confirmó #239, como señal aparte del `aria-label`.
  3. Último recurso: la palabra "Full" como texto visible dentro del bloque de envío — mismo criterio que `leerProducto` (PDP) con `/\bfull\b/i`.

  El acotado al bloque real usa la etiqueta de apertura (`<div>`/`<span>`) y busca su propio cierre, nunca una ventana de caracteres a ciegas — la primera versión de este fix sí usaba una ventana fija, y el test nuevo encontró un falso positivo real (un título "Televisor Full HD" justo después de un bloque "Envío gratis" entraba en la ventana), corregido antes de este commit.

  **Verificado (punto 3 del issue) que el bridge extensión → panel nunca fue el problema**: `content.js` y `PanelInvestigacion.tsx` ya pasaban cualquier boolean real sin pisarlo — el bug siempre estuvo en el lector.

  **Si "% FULL" sigue en 0% después de este fix**, el próximo paso real es un `outerHTML` de una tarjeta Full en vivo (DevTools → Inspeccionar → copiar el `<li>` completo) — con una función pura y testeada, un selector nuevo confirmado así se agrega en minutos.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; nunca histórico×precio como "/mes"; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` no se tocó; no se mergeó nada.

  **Pruebas nuevas**: `detectarFullEnHtmlTarjeta` suma 7 casos en `extension/lectores/mercadolibre.test.ts` — el badge real confirmado, una tarjeta con envío gratis sin Full (nunca se confunden), el respaldo por sprite (`xlink:href`), el respaldo por texto visible, dos casos explícitos de "nunca un falso positivo" (un título real con "Full" nunca cuenta, sin bloque de envío confirmado nunca se arriesga a buscar en toda la tarjeta), y entradas vacías/inválidas.

  Verificado: `npm run typecheck` en verde. `npm test`: 707 pruebas en verde (700 + 7 nuevas; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` — ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.14 → 0.3.15.
