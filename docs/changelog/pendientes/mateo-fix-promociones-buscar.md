- **2026-10-29 (Refs #44)** — Bug real en staging: una búsqueda de Promociones podía terminar "Listo (0/N)" sin ningún candidato y sin ningún aviso.

  **Causa real confirmada**: `leerPromocionesItemMl` (`lib/ml/cliente.ts`) devolvía `null` para CUALQUIER caso que no fuera un array real — una publicación sin promociones aplicables (404, legítimo), un 403 de la app sin el scope de Promociones, un 401 de la cuenta, o cualquier otro `!ok`. Los 4 casos se veían exactamente igual río abajo: ítem saltado, sin ningún rastro.

  **Arreglo (sin migración)**:
  - `lib/ml/cliente.ts` — `leerPromocionesItemMl` ahora devuelve `{estado:"ok"|"sin_permiso"|"no_autorizado"|"otro_error", ...}`. 404 pasa a `"ok"` (nunca se confunde con un fallo); 403/401/5xx/otro `!ok` quedan cada uno distinguible.
  - `lib/ml/promociones.ts` — `leerPromocionesDeItem` propaga el mismo discriminador (`sin_promos`/`con_promos`/`sin_permiso`/`no_autorizado`/`otro_error`).
  - `lib/trabajos/buscarPromocionesMultiCuenta.ts` — `buscarPromocionesCuenta` cuenta cada caso por cuenta y lo deja en el log (nunca el token). Si una cuenta acumula 5 `sin_permiso` (403) **en total** (el contador nunca resetea, no exige que sean seguidos), se frena con `estado="error"` y el mensaje "Reconectá esta cuenta en Conectar Mercado Libre — falta permiso de Promociones (scope)." — nunca sigue recorriendo el catálogo completo a ciegas contra una app que claramente no tiene el permiso.
  - `app/panel/promociones/PaginaPromociones.tsx` — el interval de polling de `/api/ml/promociones/trabajo/[jobId]` ahora se frena solo en cuanto `terminadoTs` llega (bug real también confirmado: seguía pidiendo cada 2s para siempre). Si la búsqueda terminó sin ningún candidato, ya no muestra el mismo "todavía no hay resultados — dale Buscar arriba" que una página recién abierta — muestra un resumen real por cuenta (`productosRevisados`/`itemsConPromociones`/`error`), extraído a `app/panel/promociones/resumenBusquedaVacia.ts` (sin librería de render de React en este repo — mismo criterio que `mensajes-error.ts` — se probó la función pura, no el componente).

  **Pruebas nuevas**: `lib/ml/cliente.test.ts` (los 4 estados de `leerPromocionesItemMl`, 404 ya nunca se confunde con un fallo), `lib/trabajos/buscarPromocionesMultiCuenta.test.ts` (umbral de 403 → cuenta en error con el mensaje de reconectar; menos del umbral no la frena; 401/otro_error nunca la frenan por sí solos), `app/panel/promociones/resumenBusquedaVacia.test.ts` (cuándo se muestra el resumen vacío y su texto exacto por cuenta).

  Verificado: `npm run typecheck` en verde. `npx vitest run`: 1746 pruebas en verde, mismo baseline de 44 suites fallando solo por `DATABASE_URL_APP` ausente en este sandbox (sin regresión). `npm run build`: compila y tipa en verde; falla después en el mismo punto ya conocido (`DATABASE_URL_APP` ausente al recolectar datos de página).

  No se tocó `permisos_rol` ni la migración `0018`, ni ninguna migración nueva — este arreglo es código puro.

- **2026-10-29 (Refs #44)** — Ajustes de la review de Pablo en PR #302.

  - El umbral de `sin_permiso` (403) es **acumulado, nunca resetea** y nunca exigió que fueran seguidos — solo se corrigió el texto ("en total", no "de seguida") en el comentario del código y en este changelog, el código ya era acumulado.
  - Al cruzar el umbral, ya no se lanza `PromocionesSinPermisoError` desde dentro de cada worker de `conConcurrenciaLimitada` (riesgo real de que un worker hermano, en curso al mismo tiempo, también cruzara el umbral y volviera a lanzar). Ahora es un flag compartido por cuenta (`abortadoPorSinPermiso`): el worker que cruza el umbral solo lo prende; cualquier worker (el mismo u otro) lo revisa ANTES de pedir su siguiente ítem y, si ya está prendido, devuelve `"omitido"` sin llamar a Mercado Libre y sin lanzar nada. `buscarPromocionesCuenta` revisa el flag después del lote y recién ahí marca `estado="error"` con el mensaje de reconectar. Prueba nueva que escucha `process.on("unhandledRejection", ...)` durante la búsqueda y confirma que queda vacío.
  - `productosRevisados` ahora cuenta los ítems que de verdad se le pidieron a Mercado Libre (cualquier resultado real, incluso un fallo puntual) — nunca `ids.length` de entrada. Si la cuenta se frena en el umbral, el resumen ya no sale inflado con ítems "omitidos" que nunca se llegaron a pedir.

  Verificado: `npm run typecheck` en verde, `npx vitest run` sin regresión (mismo baseline de siempre).
