- **feat-publicidad-prueba-escritura** — Fase 4 de Publicidad, paso 0 (issue #257): script `scripts/probar-escritura-publicidad.ts` para verificar si la API de Mercado Libre deja **modificar** una campaña de Product Ads de un vendedor de Colombia. Hoy la escritura solo está documentada para Global Selling.
  - Le agrega " (prueba)" al nombre de **una** campaña, verifica que nada más cambió (estado, presupuesto, ROAS objetivo, estrategia) y la devuelve al nombre original.
  - Sin `--aplicar` solo lee y muestra el plan. Con `--aplicar` exige `--autorizado-por`.
  - Usa una sola ruta, la documentada. Si falla, no prueba otras.
  - No imprime el token ni la respuesta cruda.
  - Guía para el equipo: `docs/publicidad/prueba-escritura.md`.
  - **No cambia la aplicación:** la pantalla sigue siendo solo lectura y `lib/ml/publicidad.ts` sigue sin escribir. Sin migración.

  Verificado: `tsc --noEmit` y `scripts/probar-escritura-publicidad-logica.test.ts` (argumentos, nombre de prueba, cambios inesperados, error resumido). **No se corrió contra Mercado Libre:** eso lo hace el equipo con la autorización del responsable de la cuenta piloto.
