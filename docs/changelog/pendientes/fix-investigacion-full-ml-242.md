- **2026-10-25** — issue #242 (Refs), quinto intento de Full ML — esta vez con el selector REAL, confirmado hoy en producción por Zilonix OS. 0.3.14/0.3.15 (#239/#241) seguían en 0%.

  **Causa real, encontrada esta vez sin Wayback**: Zilonix OS (`mateodta2-code/zilonix-os`, `chrome-extension-busqueda/scraper-listado.js`, comentado "DOM vivo confirmado 6/10") ya detecta Full correctamente en producción con:

  ```js
  const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  ```

  Es, literalmente, el mismo selector que #229 ya había usado — #239 lo sacó pensando (con evidencia de Wayback, que solo captura el HTML que el SERVIDOR manda, no necesariamente el DOM ya hidratado) que el aria-label real era solo `"FULL"`, sin `"Enviado por"`. Esa conclusión era la equivocada: el valor real completo sí es `"Enviado por FULL"` — confirmado ahora con código que corre en producción, no con otra captura estática.

  **El intento de #241 (`detectarFullEnHtmlTarjeta`) tenía DOS problemas, no uno**: su capa 1 exigía `aria-label="full"` exacto (nunca matcheaba `"Enviado por FULL"`, un valor más largo), y su capa de texto "strippeaba" la etiqueta `<svg aria-label="...">` entera (atributos incluidos) antes de buscar la palabra — el valor del atributo nunca llegaba a quedar como texto visible para esa búsqueda, así que ni el respaldo podía rescatar el caso real.

  **Corrección**: `detectarFullEnTarjeta(tarjeta)` (nueva, DOM) prueba primero el selector exacto de Zilonix OS — directo, confirmado en producción — y solo si eso no matchea, cae a `detectarFullEnHtmlTarjeta` (de #241) como respaldo, con su capa 1 corregida de exact-match a substring — acotada al bloque de envío real, igual que siempre, para nunca confundir un `aria-label="Enviado por FULL"` con un título real tipo "Televisor Full HD".

  **Brasil**: Zilonix OS nunca tocó Mercado Libre Brasil — no hay confirmación propia de ese lado. Se asume el mismo texto `"Enviado por FULL"` sin inventar una variante distinta ("Enviado"/"por" son la misma palabra en español y portugués, "FULL" nunca se traduce, confirmado en #239) — si Brasil usa otra redacción, el respaldo por substring/texto debería seguir agarrándolo.

  **Verificado (punto 5 del issue)**: el bridge extensión → panel → KPI % Full sigue intacto — `content.js`/`PanelInvestigacion.tsx`/`lib/ml/listadoCliente.ts` ya pasaban cualquier boolean real sin pisarlo desde #241; el bug siempre estuvo en la extracción, nunca en el puente.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; nunca histórico×precio como "/mes" (el bug real de OS que explícitamente no se copia); `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` no se tocó; no se mergeó nada.

  **Pruebas nuevas**: `detectarFullEnHtmlTarjeta` suma un caso de regresión directa con `aria-label="Enviado por FULL"` (el valor real confirmado) y el fixture principal del describe se corrigió al mismo valor real (antes usaba el valor equivocado de #241, `"FULL"` solo).

  Verificado: `npm run typecheck` en verde. `npm test`: 708 pruebas en verde (707 + 1 nueva; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` — ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.15 → 0.3.16.
