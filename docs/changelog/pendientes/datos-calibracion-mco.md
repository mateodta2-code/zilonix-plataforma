- **2026-10-27** — issue #251: corrida real (solo lectura, túnel SSH de Railway a staging, sin tokens de ML) de `scripts/generar-calibracion-id-fecha.ts` contra la base de staging, para calibrar `antiguedadDiasPorId()`/`antiguedadDias()` con pares id→fecha reales.

  **Resultado: 0 puntos en ninguna de las dos fuentes todavía.**
  - **Fuente 1** (`seguimiento_fotos.publicaciones.fechaCreacion`, competidores con date_created confirmado por la API): 0 puntos. El cron que guarda ese campo es del PR #261 (reciente); staging todavía no acumuló suficientes corridas para tener ningún `fechaCreacion` confirmado. Un seguimiento de catálogo (`recurso_ml` "product") se omitió correctamente, por diseño: su único dato disponible era la fecha del ítem ganador, nunca se usa esa fecha para el catálogo.
  - **Fuente 2** (`productos_ml.resultado[].itemId` + `publicado_ts`, publicaciones propias): 0 puntos. Staging no tiene ninguna publicación propia con `resultado` de éxito registrado todavía.

  Con 0 puntos no hay rango de fechas que reportar, y ningún país+tipo llega ni al mínimo técnico de 2 (mucho menos a los 4-6 que hacen falta para una interpolación razonable — ver el propio script). `lib/seguimiento/calibracion-aproximados.json` queda sin cambios (`"puntos": []`) — no hay nada real para pegar todavía.

  **Sin cambios de código ni de datos en este fragmento** — es un hallazgo de diagnóstico, para que la próxima corrida (cuando staging acumule más historial del cron del PR #261, o publicaciones propias reales) sepa desde dónde parte.

  Sin migraciones, `extension/` sin tocar.

- **2026-10-27 (segunda parte)** — mientras `scripts/generar-calibracion-id-fecha.ts` sigue en 0 pares confirmados, se cargaron 9 puntos de calibración REFERENCIALES del panel de Selltrix (el mismo competidor que ya estima antigüedad por id) + 1 punto REAL confirmado:

  - **`lib/seguimiento/calibracion-aproximados.json`**: 5 puntos "item" (MCO602965132, MCO1333873907, MCO1742001365, MCO1836584643, MCO2275587337) y 4 "product" (MCO24729698, MCO52242836, MCO52762065, MCO2068057559). Las fechas de los 8 de Selltrix se derivaron con la MISMA fórmula que usa esa pantalla (días = vendidosEst × 30 / (facturaciónMes / precio)) — son referenciales, no un `date_created` confirmado por la API, por eso siguen marcados "aprox." igual que el resto de la tabla. El noveno, **MCO2275587337, es un dato real**: publicación propia de Zilonix cuya primera venta (14 oct 2026, Mis Ventas de Mercado Libre) cuadra con la fecha de Selltrix para ese id — ancla la serie "item" contra un punto no inferido. Los factores `2.2`/`1.55` no cambiaron.
  - Publicaciones **internacionales** (envío desde China, ej. MCO4106040446 ≈ 2026-06-27 según Selltrix) usan otra serie de numeración de MCO — a propósito NO entraron a `puntos`: mezclarlas tuerce la interpolación de las domésticas. Con el tope de 90 días de extrapolación (`LIMITE_EXTRAPOLACION_DIAS`), un id de esa serie pedido como "item" sigue dando "Sin dato" (null) — verificado con un test nuevo.
  - **`lib/seguimiento/aproximados.ts`**: comentario junto a `PUNTOS_CALIBRACION_ID_FECHA` reescrito explicando el origen de estos 9 puntos (antes decía "SIN PUNTOS TODAVÍA").
  - **`extension/`** (avisado antes de tocarla): `calibracion-aproximados.js` regenerado desde el JSON canónico con `scripts/empaquetar-extension.js` (nunca a mano); `extension/version.json` y `extension/manifest.json` subidos a **0.3.35**.
  - **Tests nuevos** (`lib/seguimiento/aproximados.test.ts`, con `PUNTOS_CALIBRACION_ID_FECHA` real y `ahora` fijo en 2026-10-27): MCO2275587337 (item) ≈16 días, MCO1836584643 (item) ≈250, MCO602965132 (item, el punto más viejo) ≈2129 (±3), MCO2068057559 (product) ≈195; un id ENTRE dos puntos item interpola estrictamente entre sus antigüedades; MCO4106040446 (internacional) como item → null; y el mismo id da un resultado DISTINTO según se pida como "item" o "product" (nunca mezcla las dos series), probado con los puntos reales en las dos direcciones.
  - **2 tests existentes corregidos** (su premisa de "tabla de calibración vacía" quedó obsoleta con los puntos reales de arriba — no es una regresión, es que ahora SÍ hay calibración real y esos tests necesitaban aislarse de ella para seguir probando el caso "sin ningún punto calibrado" a propósito, pasando `puntos: []` explícito): `extension/lectores/aproximados.test.ts` ("sin date_created y sin puntos calibrados -> null") y `lib/ml/listadoCliente.test.ts` ("catálogo sin antigüedad calibrada: vendidosEst presente").

  Verificado: `npm test` — 1002 pruebas en verde (29 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_SEGUIMIENTO`, ambiental, sin Postgres real en este sandbox — baja de 30 a 29 porque el fix de `listadoCliente.test.ts` de arriba corre sin Postgres). `npm run typecheck` en verde. Sin script `lint` en este repo (confirmado, no existe en `package.json`). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido (`DATABASE_URL_APP` al recolectar datos de página).

  Sin migraciones. No se abrió Pull Request (a pedido). No se usó ni refrescó ningún token de Mercado Libre.

  Refs #251
