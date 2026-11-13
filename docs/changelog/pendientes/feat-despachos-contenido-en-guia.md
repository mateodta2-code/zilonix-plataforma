- **feat-despachos-contenido-en-guia** — "Ver guía" y "Ver guía (sticker)" de `/panel/despachos` ahora traen, debajo de la guía de Mercado Libre, una franja **CONTENIDO (N unidades)** con `cantidad x producto` (+ `SKU` si lo hay) por cada ítem del pedido — quien empaca ve qué va en el paquete junto a la etiqueta.

  La guía original de Mercado Libre no se toca: cada página se alarga hacia abajo con la franja (`agregarContenidoAEtiqueta` en `lib/pdf-etiqueta.ts`), en vez de escribir encima de su diseño (no se sabe dónde queda espacio libre y tapar un código de barras dejaría la guía inservible). El sticker de 10x15cm se arma a partir de la guía ya con la franja. Caracteres que Helvetica no puede dibujar (emojis en el título) se quitan en vez de romper el PDF. `obtenerDespachoParaGuia` ahora también devuelve los ítems del pedido (`pedido_items`, con `empresa_id` explícito).

  Fuera de alcance: la impresión masiva (`/api/ml/despachos/etiquetas`) sigue igual — con varios envíos en un solo PDF de Mercado Libre no hay forma confirmada de saber qué página es de qué envío.

  Sin migraciones; `extension/` y `db/schema.ts` sin tocar.

  Verificado: `npm run typecheck` en verde; `npx vitest run lib/pdf-etiqueta.test.ts` — 8 pruebas en verde (5 nuevas).
