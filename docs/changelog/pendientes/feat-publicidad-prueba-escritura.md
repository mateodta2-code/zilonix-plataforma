- **feat-publicidad-prueba-escritura** — Fase 4 de Publicidad, paso 0 (issue #257): script `scripts/probar-escritura-publicidad.ts` para verificar si la API de Mercado Libre deja **modificar** una campaña de Product Ads de un vendedor de Colombia. Hoy la escritura solo está documentada para Global Selling.
  - Le agrega " (prueba)" al nombre de **una** campaña, verifica que nada más cambió (estado, presupuesto, ROAS objetivo, estrategia) y la devuelve al nombre original.
  - Sin `--aplicar` solo lee y muestra el plan. Con `--aplicar` exige `--autorizado-por`.
  - `--nombre="vendedor 2"` usa un nombre temporal libre en vez del sufijo (pedido de Mateo en la revisión); igual se revierte al original.
  - Usa una sola ruta, la documentada. Si falla, no prueba otras.
  - No imprime el token ni la respuesta cruda.
  - Guía para el equipo: `docs/publicidad/prueba-escritura.md`.
  - **No cambia la aplicación:** la pantalla sigue siendo solo lectura y `lib/ml/publicidad.ts` sigue sin escribir. Sin migración.

  Verificado: `tsc --noEmit` y `scripts/probar-escritura-publicidad-logica.test.ts` (argumentos, nombre de prueba, cambios inesperados, error resumido). **Corrida real (14/11, staging, FMCBIENESTAR, autorizó Mateo Barrientos):** la lectura funcionó y el `PUT` respondió **401** `User does not have permission to write`. La campaña no cambió. El resultado y los pasos siguientes quedaron anotados en `docs/publicidad/api-research.md` §3 y en `prueba-escritura.md`.
