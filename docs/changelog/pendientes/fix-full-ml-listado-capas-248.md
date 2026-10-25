- **2026-10-25** — issue #248 (Refs), Full del listado — #247 (espera de hidratación) no alcanzó: smoke de Pablo sobre listado CO "tetero" con 0.3.19 seguía en 0/48, incluso con el filtro **FULL** de Mercado Libre puesto en la URL (donde las 48 tarjetas, por definición del filtro, SON Full). Ficha sigue OK (#245).

  **Contexto real de Pablo (en vivo)**: el badge Full visible hoy es un logo verde itálico "FULL" + un rayo, junto a "Llega gratis mañana" — y ese texto SOLO no implica Full (hay tarjetas con ese mismo texto que no son Full). Esto, sumado al 0/48 con el filtro puesto, apunta a que el selector exacto de OS (`svg[aria-label="Enviado por FULL"]`) y el respaldo acotado al bloque `poly-component__shipp(ed-from|ing)` (#241/#242) ya no matchean nada del DOM vivo de hoy.

  **Por instrucción explícita del issue, no se adivinó desde Wayback ni desde el comentario viejo de Zilonix OS esta vez.** Sin HTML real citado todavía (no se consiguió dentro de esta sesión — ver el diagnóstico temporal, abajo), se ensanchó el detector en capas, de más a menos específico, sobre la tarjeta ENTERA:

  1. **Capa 1 (nueva)** — atributos reales del ícono (`aria-label` que contenga "full", `href` de sprite `poly_full`/`icon-poly_full`, clase `poly_full`/`icon-poly_full`) en cualquier parte de la tarjeta — ninguno existe nunca en un título real, seguro sin acotar.
  2. **Capa 2 (#241/#242, sin cambios en su lógica)** — el bloque `poly-component__shipp(ed-from|ing)` real, cuando existe — pero su AUSENCIA ya nunca hace fallar todo el detector (antes de #248, `return false` en seco si el bloque no estaba — el bug real detrás del 0/48 con el filtro puesto).
  3. **Capa 3 (nueva)** — "full" suelto, pero solo cerca de "Llega"/"Envío" (contexto real descrito por Pablo), con el título del producto SACADO primero (`quitarTituloDeHtml`) — nunca "Televisor Full HD" cuenta, sin importar cuánto se relaje el resto.

  **Diagnóstico temporal** (`volcarDiagnosticoFullSiHaceFalta`, en `leerListado`): si un listado tiene productos pero ninguno sale Full con las 3 capas, se vuelca a la consola una muestra real de hasta 3 tarjetas (outerHTML recortado a 600 caracteres) — para conseguir HTML real sin pedírselo a mano, si esto tampoco alcanza. Una sola vez por carga de página. Marcado explícitamente como temporal — se saca una vez que el smoke confirme el fix real.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` (#246) no se tocó; no se mergeó nada; no se adivinó HTML de Wayback.

  **Tests**: 6 pruebas nuevas para `detectarFullEnHtmlTarjeta` — Capa 1 por aria-label fuera del bloque viejo, Capa 1 por clase del ícono fuera del bloque viejo, Capa 3 por texto cerca de "Llega", regresión directa de "Llega gratis mañana" solo (sin Full) → false, título "Full HD" sin badge real → false, el bloque `poly-component__shipp*` real de #241/#242 sigue funcionando igual.

  Verificado: `npm run typecheck` en verde. `npm test`: 719 pruebas en verde (713 + 6 nuevas; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`, ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.19 → 0.3.20.
