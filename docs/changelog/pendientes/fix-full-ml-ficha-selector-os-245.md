- **2026-10-25** — issue #245 (Refs), séptimo intento de Full ML — esta vez calcando EXACTO el selector que Zilonix OS ya usa en producción, sin inventar nada propio. Smoke de Sharel con "Zelotes F35" (badge FULL visible en la ficha) seguía marcando "Full: No" en 0.3.17 (#243).

  **Causa real**: Mateo confirmó, leyendo Zilonix OS de nuevo, que ese repo **no tiene ningún detector de Full en la ficha de producto** — solo en el listado (`chrome-extension-busqueda/scraper-listado.js`):

  ```js
  const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  ```

  El bug real de #243 era que `detectarFullEnHtmlEnvio` solo corría cuando `bloqueEnvio` (el contenedor del resumen de envío) se resolvía primero (`const esFull = bloqueEnvio ? detectarFullEnHtmlEnvio(...) : false`) — si ese contenedor no se encontraba, `esFull` caía siempre a `false` sin importar si el badge real estaba visible. Ese gate era el bug, no el regex de detección en sí.

  **Corrección**: `detectarFullEnHtmlFicha(htmlFicha)` (nueva, pura, reemplaza a `detectarFullEnHtmlEnvio`) copia el MISMO criterio de OS tal cual — match exacto del ícono `svg[aria-label="Enviado por FULL"]`, sin respaldo de texto plano inventado sin evidencia real. `leerProducto` ya nunca gatea `esFull` a `false` por falta de contenedor: busca el ícono dentro del bloque de envío real si se resolvió (de #243, también sirve para no confundir el Full de este producto con el de uno DISTINTO en el carrusel de "productos relacionados" de la misma página) y, si no, en la ficha completa — igual que el criterio simple de OS. `envioGratis` no se tocó.

  **Pruebas**: reemplazadas las 6 de #243 por 5 nuevas para `detectarFullEnHtmlFicha` — ícono svg real → true; sin ícono (envío gratis normal) → false; solo texto "Almacenado y enviado por FULL" SIN el ícono → false (a propósito: OS nunca confirmó un detector por texto); título "Full HD" sin ícono → false; entradas vacías/inválidas → false.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` no se tocó; no se mergeó nada.

  Verificado: `npm run typecheck` en verde. `npm test`: 713 pruebas en verde (714 de #243, -1 neto por consolidar 6 pruebas viejas en 5 nuevas; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` — ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.17 → 0.3.18.
