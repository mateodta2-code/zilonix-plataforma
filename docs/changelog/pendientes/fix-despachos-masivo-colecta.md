- **fix-despachos-masivo-colecta** — La impresión masiva seguía trayendo la hoja de lista de despacho (manifiesto) en envíos de **colecta**: ahí Mercado Libre manda la guía en A4 **horizontal** (841.89 x 595.28 pt), no en 10x15 como Flex, así que guía y lista eran A4 las dos y el seguro "si todas son A4, no quitar nada" dejaba el PDF completo (#386).

  Regla corregida con 2 PDFs reales (Flex y colecta, 2026-11-13): la lista es la hoja A4 **vertical** (595.28 x 841.89 pt); la guía viene en 10x15 o en A4 horizontal. `esHojaDeLista` reemplaza a `esHojaA4` en `lib/pdf-etiqueta.ts`. La franja CONTENIDO de "Ver guía" ahora sí se agrega a la guía de colecta (antes la saltaba por ser A4).

  Verificado: `npm run typecheck` en verde; `npx vitest run lib/pdf-etiqueta.test.ts` — 14 pruebas en verde (2 nuevas); con el PDF real de colecta del lote (2 hojas) sale 1 hoja, la guía horizontal.
