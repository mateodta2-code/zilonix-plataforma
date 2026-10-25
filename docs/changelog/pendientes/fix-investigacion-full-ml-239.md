- **2026-10-25** — issue #239 (Refs), tercer intento de Full ML — esta vez confirmado DENTRO de una tarjeta de producto real. Dos intentos anteriores (#229, #236) habían cambiado el selector sin encontrar el marcador real dentro de una tarjeta — los dos terminaron apuntando a otros elementos de la página (un filtro de la barra lateral, nunca la tarjeta en sí), así que seguían sin matchear nada real: "% FULL" en 0%, columna Full en "No" para todas las filas, en Colombia y Brasil por igual.

  **Evidencia real (Wayback Machine, dos capturas frescas — el acceso directo a Mercado Libre sigue bloqueado desde este sandbox)**: `listado.mercadolibre.com.co/gorras` (50 de 51 tarjetas reales con el badge) y `lista.mercadolivre.com.br/tenis` (mismo resultado exacto). El badge real DENTRO de una tarjeta es:

  ```html
  <span class="poly-component__shipped-from">Enviado por
    <svg aria-label="FULL" width="41" height="13" viewbox="0 0 41 13" role="img">
      <use href="#poly_full"></use>
    </svg>
  </span>
  ```

  El `aria-label` real del `<svg>` es literalmente `"FULL"` (4 letras) — nunca `"Enviado por FULL"` (esa frase vive afuera del `svg`, en el `<span>` que lo envuelve; de ahí el bug real de #229). Tampoco tiene `data-testid="icon-poly_full"` ni la clase `ui-search-icon--full` que había asumido #236 — esos sí existen en la página, pero en el filtro "Envío · Full" de la barra lateral, un elemento que `leerListado` nunca llega a leer (vive fuera de `li.ui-search-layout__item`). Polycard es el mismo componente compartido entre países — "FULL" nunca se traduce, ni en Brasil. Corregido: `esFull` (`extension/lectores/mercadolibre.js`, `leerListado`) ahora usa un único selector confirmado, `svg[aria-label="FULL" i]` — se sacan los 3 selectores viejos (#229/#236), confirmados ahora que apuntaban a elementos equivocados.

  **De paso (punto 4 del issue)**: Brasil también mostraba Calificación "—" — confirmado que el texto de accesibilidad real ahí es "Avaliação X de 5" (portugués), nunca "Calificación" (español); `leerCalificacionYVendidosListado` solo reconocía la palabra en español. Se suma la alternativa en portugués (el formato del número, con coma decimal, es igual en los dos idiomas). "Vendidos: Sin dato" en Brasil se confirmó **correcto, no un bug**: tanto Colombia como Brasil, en las categorías revisadas, solo muestran la etiqueta cualitativa "MÁS VENDIDO"/"MAIS VENDIDO" sin ninguna cifra en la tarjeta — `null` ahí es honesto. Se sumó una generalización defensiva a "productos/produtos vendidos" por si otra categoría sí muestra el número en portugués (documentada como no confirmada contra una captura con cifra real — nunca se inventó un número). "Fact. est. —" en ML se confirmó correcto desde #227 (ML nunca es `mensual_piso`, solo Amazon lo es).

  **Fuera de alcance, documentado**: `envioGratis` en `leerProducto` (PDP) sigue en español únicamente (`/envío\s*gratis|envio\s*gratis/i`), nunca probado contra "frete grátis" — no estaba en el pedido explícito de este issue (que es sobre `leerListado`/Full) y no se tocó.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; nunca histórico×precio como "/mes"; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` no se tocó; no se mergeó nada.

  Verificado: `npm run typecheck` en verde. `npm test`: 700 pruebas en verde (mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` — ninguno nuevo; sin pruebas nuevas — `esFull`/`leerCalificacionYVendidosListado` viven dentro de `leerListado`, que depende de DOM real, mismo criterio documentado en `extension/LEEME.md` sobre qué se prueba con vitest y qué no). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.13 → 0.3.14.
