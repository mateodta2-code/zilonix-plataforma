- **feat-despachos-masivo-por-cuenta** — La pestaña "Impresión masiva de guías" agrupa las guías **por cuenta de Mercado Libre** (pendientes y "Ya impresas — reimprimir"), cada cuenta con su título ("CUENTA FMCBIENESTAR (3)") y sus propios botones de imprimir. Antes salían todas juntas y marcadas, sin columna de cuenta: con dos cuentas el lote fallaba de entrada ("Elige despachos de una sola cuenta de Mercado Libre a la vez") sin forma de saber cuál era de cuál (reportado en staging, 2026-11-13).

  Además: columna **Producto** ("2 x Gorra azul", de `listarItemsPorEnvio`) para saber qué guía es cuál, el estado en español (`etiquetaEstadoEnvio`, antes salía "READY_TO_SHIP") y el aviso "Mostrando hasta 25 de 7" se cambia por uno que solo aparece cuando de verdad hay más de 25 pendientes. La columna Cuenta de "reimprimir" sale (ya va en el título del grupo).

  Sin migraciones; `extension/` y `db/schema.ts` sin tocar.

  Verificado: `npm run typecheck` en verde; `npx vitest run app/panel/despachos/ImpresionMasivaForm.test.tsx lib/pdf-etiqueta.test.ts scripts/verificar-permisos.test.ts` — 267 en verde (1 nueva).
