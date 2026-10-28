- **2026-10-27** — issue #251: corrida real (solo lectura, túnel SSH de Railway a staging, sin tokens de ML) de `scripts/generar-calibracion-id-fecha.ts` contra la base de staging, para calibrar `antiguedadDiasPorId()`/`antiguedadDias()` con pares id→fecha reales.

  **Resultado: 0 puntos en ninguna de las dos fuentes todavía.**
  - **Fuente 1** (`seguimiento_fotos.publicaciones.fechaCreacion`, competidores con date_created confirmado por la API): 0 puntos. El cron que guarda ese campo es del PR #261 (reciente); staging todavía no acumuló suficientes corridas para tener ningún `fechaCreacion` confirmado. Un seguimiento de catálogo (`recurso_ml` "product") se omitió correctamente, por diseño: su único dato disponible era la fecha del ítem ganador, nunca se usa esa fecha para el catálogo.
  - **Fuente 2** (`productos_ml.resultado[].itemId` + `publicado_ts`, publicaciones propias): 0 puntos. Staging no tiene ninguna publicación propia con `resultado` de éxito registrado todavía.

  Con 0 puntos no hay rango de fechas que reportar, y ningún país+tipo llega ni al mínimo técnico de 2 (mucho menos a los 4-6 que hacen falta para una interpolación razonable — ver el propio script). `lib/seguimiento/calibracion-aproximados.json` queda sin cambios (`"puntos": []`) — no hay nada real para pegar todavía.

  **Sin cambios de código ni de datos en este fragmento** — es un hallazgo de diagnóstico, para que la próxima corrida (cuando staging acumule más historial del cron del PR #261, o publicaciones propias reales) sepa desde dónde parte.

  Sin migraciones, `extension/` sin tocar.

  Refs #251
