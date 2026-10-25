- **2026-10-25** — issue #248 (Refs), vuelta 4 — simplificación pedida por Mateo. La vuelta 3 confirmó que el bug restante era 100% timing, no un selector mal: el detector ya reconocía el badge real citado. Zilonix OS nunca tuvo capas de texto/atributos ni una espera de hidratación específica para Full — solo:

  ```js
  await esperarTarjetas(); // 15s, cantidad estable 1s
  const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  ```

  **Se sacó todo lo agregado en #241/#242/#248 (vueltas 1 a 3) que no era ese criterio simple**:

  - `extension/lectores/mercadolibre.js`: las capas de texto/atributos de `detectarFullEnHtmlTarjeta` (acotamiento al bloque `poly-component__shipp*`, búsqueda de "full" suelto cerca de "Llega"/"Envío", `quitarTituloDeHtml`) se sacaron. `detectarFullEnTarjeta` vuelve a ser un solo `Boolean(U.primerElemento(['svg[aria-label="Enviado por FULL"]'], tarjeta))`. `detectarFullEnHtmlTarjeta` queda SOLO como la versión de texto del mismo selector único, para poder probarlo sin DOM (este proyecto no tiene jsdom/happy-dom) — nunca se llama desde ningún camino real, `detectarFullEnTarjeta` (DOM) es el único detector que corre en producción.
  - El diagnóstico temporal completo (`volcarDiagnosticoFullSiHaceFalta`, `extraerDiagnosticoFullDeTarjeta`, `textoPropioDe`) se sacó entero — ya cumplió su función (consiguió el HTML real de la vuelta 3).
  - `extension/content.js`: la segunda fase de espera de hidratación específica para Full (`ESPERA_HIDRATACION_ENVIO_MS`, que había subido 1.8s → 6.5s → 12s en las vueltas 1-3 buscando el bug equivocado) se sacó entera. `esperarListadoEstable` vuelve a ser solo la espera de cantidad de tarjetas estable (1s), con el mismo tope de 14s de siempre (issue #233, sin cambios) — el mismo criterio simple de `esperarTarjetas()` de Zilonix OS.

  **Lo que queda, sin tocar**: `filtroFullActivoEnUrl` (issue #248, vuelta 2) — la señal de la URL del filtro Full sigue como un OR opcional sobre el detector real (`const esFull = filtroFullActivo || detectarFullEnTarjeta(tarjeta)`), nunca su reemplazo.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` (#246) no se tocó; no se mergeó nada.

  **Tests**: se consolidaron los 24 tests de las capas removidas en 8 tests mínimos para `detectarFullEnHtmlTarjeta` — el HTML real de la vuelta 3 → true; el selector exacto de Zilonix OS (#242) → true; envío gratis sin Full → false; título "Full HD" sin el svg real → false; `poly-bookmark__icon-full` (favorito, advertencia de Mateo) → false; entradas vacías/inválidas → false. Los 6 tests de `filtroFullActivoEnUrl` (vuelta 2) quedan sin cambios.

  Verificado: `npm run typecheck` en verde. `npm test`: 717 pruebas en verde (menos que antes por la consolidación de tests de capas removidas; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`, ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.22 → 0.3.23.
