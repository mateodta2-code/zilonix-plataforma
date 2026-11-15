- **feat-despachos-masivo-solo-guias** — La impresión masiva (`/api/ml/despachos/etiquetas`) entrega **solo las guías**, sin la hoja de lista de despacho ("Identificación / Productos", el manifiesto) que Mercado Libre agrega al PDF.

  Evidencia real (guía Flex descargada de staging, 2026-11-13): `/shipment_labels` trae la guía en 10x15cm (283.46 x 425.20 pt) y la lista en A4 (595.28 x 841.89 pt). `quitarHojasDeLista` (`lib/pdf-etiqueta.ts`) quita las hojas A4; si todas o ninguna son A4, el PDF vuelve tal cual (nunca un PDF vacío ni se quita una guía por adivinar). Si el recorte falla, se entrega el PDF completo de Mercado Libre.

  De paso: la franja CONTENIDO de "Ver guía" (#385) ya no se agrega a la hoja A4 de lista (esa hoja ya trae producto y cantidad); solo a la guía. "Ver guía" individual sigue trayendo la lista, como antes.

  Sin migraciones; `extension/` y `db/schema.ts` sin tocar.

  Verificado: `npm run typecheck` en verde; `npx vitest run lib/pdf-etiqueta.test.ts` — 12 pruebas en verde (4 nuevas). Falta confirmar en staging con un lote real.
