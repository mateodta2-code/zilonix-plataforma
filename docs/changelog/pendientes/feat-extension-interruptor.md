- **2026-10-28** — issue #273 (Mateo, ext 0.3.39): "el panel de la extensión aparece siempre en Mercado Libre, y si lo minimizo o lo cierro vuelve enseguida".

  **Causa real**: `reescanear()` (`content.js` — el `MutationObserver` que observa `document.body` + el `setInterval` que detecta navegación SPA) se dispara con CUALQUIER mutación del DOM — muchas por segundo en una página ML viva — y nunca chequeaba nada antes de llamar a `obtenerOCrearPanel()`. El botón ✕ solo hacía `host.remove()`, sin avisarle a nada que esa pestaña lo había cerrado — el próximo tick lo volvía a crear. Minimizar tampoco sobrevivía: `renderizarEsqueleto` hace `panel.innerHTML = "..."` en CADA `reescanear()`, perdiendo el `hidden` del clic de colapsar casi de inmediato.

  **Arreglo, sin ningún permiso ni `host_permission` nuevo** (`"storage"` ya existía):

  1. **Interruptor global** Encendido/Apagado (`chrome.storage.local`, default ON — comportamiento de siempre) — switch visible en el encabezado de los 3 tipos de panel (producto/tienda/listado), textos en español ("Zilonix encendido"/"Zilonix apagado"), con los colores de marca de `panel.css`. Apagado: `content.js` no inyecta nada automático en ninguna página — ni el panel, ni el relevo silencioso de "Completar vendidos"/Seguimiento (el interruptor corta `reescanear()` antes de tocar el DOM, así que es de verdad global). `chrome.storage.onChanged` mantiene el estado al día en todas las pestañas sin recargar.
  2. **Cerrado por pestaña** (`sessionStorage`, nunca sobrevive una pestaña nueva): el botón ✕ ahora también marca "cerrado en esta pestaña" — se reabre solo con un clic real en el ícono de la extensión.
  3. **Minimizado por pestaña** (mismo mecanismo, otra clave): el botón ▾/▸ ahora persiste el estado y `renderizarEsqueleto` lo reaplica en cada reconstrucción del esqueleto.
  4. **Ícono de la extensión** (`chrome.action.onClicked` — `manifest.json` suma `"action": {}` SIN `default_popup`, para que `onClicked` se dispare; `chrome.action` es núcleo de Manifest V3, nunca necesita permiso declarado): un clic real SIEMPRE muestra el panel en la pestaña activa (mensaje nuevo `"zilonix:mostrar-panel"`, `background.js` → `content.js`, mismo relevo de siempre sin permiso `"tabs"`), limpiando cerrado/minimizado de esa pestaña — funciona aunque el interruptor global esté apagado.

  **Nunca rompe** "Seguir tienda en Zilonix", "Completar vendidos", el relevo de Seguimiento ni "Importar a Publicar" — todos cuelgan del mismo `reescanear()` de siempre, solo gateado por 2 chequeos nuevos al principio; siguen funcionando igual con el panel visible o abierto con el ícono. Con el interruptor apagado y sin abrir con el ícono, estos flujos tampoco corren — consecuencia esperada de un interruptor de verdad global, no solo visual.

  **Reglas duras reafirmadas**: sin navegación nueva, sin login, sin evasión de captcha, sin clic/carrito/compra simulado — solo decide CUÁNDO `reescanear()` puede dibujar lo que ya hacía.

  Extensión subida a **0.3.40** (`extension/version.json` + `manifest.json`), `extension/LEEME.md` actualizado con el detalle completo.

  **Tests nuevos**: `extension/content.test.ts` — `valorInterruptorDesdeStorage`, `debeReescanearAuto` (las 4 combinaciones interruptor×cerrado, el invariante real de "nunca se reinyecta solo"), `leerPanelCerrado`/`escribirPanelCerrado`, `leerPanelMinimizado`/`escribirPanelMinimizado` (con un storage-fake en memoria, sin `sessionStorage` real). `extension/background.test.ts` — `chrome.action.onClicked` manda `"zilonix:mostrar-panel"` a la pestaña correcta, nunca revienta sin `tab.id`.

  Verificado: `npm test` en verde (196/196 tests de `extension/`; ver el estado completo más abajo en el resumen de este changelog). `npm run typecheck` en verde.

  Sin migraciones. `extension/` tocada — avisado antes (Pablo lo anota en el diario del equipo); verificado que ningún PR abierto hacia `main` tocara `extension/` (GitHub API pública, sin `gh` disponible en este entorno: de los 6 PRs abiertos con base `main`, ninguno toca `extension/`; el único PR que sí la toca, #249 "release: v0.4.0", tiene base `produccion`, no `main`). No se abrió PR (a pedido). Merge only, nunca rebase.

  Refs #273
