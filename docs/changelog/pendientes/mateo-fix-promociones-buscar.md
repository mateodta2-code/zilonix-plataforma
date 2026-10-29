- **2026-10-29 (Refs #44)** — Bug real en staging: una búsqueda de Promociones podía terminar "Listo (0/N)" sin ningún candidato y sin ningún aviso.

  **Causa real confirmada**: `leerPromocionesItemMl` (`lib/ml/cliente.ts`) devolvía `null` para CUALQUIER caso que no fuera un array real — una publicación sin promociones aplicables (404, legítimo), un 403 de la app sin el scope de Promociones, un 401 de la cuenta, o cualquier otro `!ok`. Los 4 casos se veían exactamente igual río abajo: ítem saltado, sin ningún rastro.

  **Arreglo (sin migración)**:
  - `lib/ml/cliente.ts` — `leerPromocionesItemMl` ahora devuelve `{estado:"ok"|"sin_permiso"|"no_autorizado"|"otro_error", ...}`. 404 pasa a `"ok"` (nunca se confunde con un fallo); 403/401/5xx/otro `!ok` quedan cada uno distinguible.
  - `lib/ml/promociones.ts` — `leerPromocionesDeItem` propaga el mismo discriminador (`sin_promos`/`con_promos`/`sin_permiso`/`no_autorizado`/`otro_error`).
  - `lib/trabajos/buscarPromocionesMultiCuenta.ts` — `buscarPromocionesCuenta` cuenta cada caso por cuenta y lo deja en el log (nunca el token). Si una cuenta acumula 5 `sin_permiso` (403) seguidos, se frena con `estado="error"` y el mensaje "Reconectá esta cuenta en Conectar Mercado Libre — falta permiso de Promociones (scope)." — nunca sigue recorriendo el catálogo completo a ciegas contra una app que claramente no tiene el permiso.
  - `app/panel/promociones/PaginaPromociones.tsx` — el interval de polling de `/api/ml/promociones/trabajo/[jobId]` ahora se frena solo en cuanto `terminadoTs` llega (bug real también confirmado: seguía pidiendo cada 2s para siempre). Si la búsqueda terminó sin ningún candidato, ya no muestra el mismo "todavía no hay resultados — dale Buscar arriba" que una página recién abierta — muestra un resumen real por cuenta (`productosRevisados`/`itemsConPromociones`/`error`), extraído a `app/panel/promociones/resumenBusquedaVacia.ts` (sin librería de render de React en este repo — mismo criterio que `mensajes-error.ts` — se probó la función pura, no el componente).

  **Pruebas nuevas**: `lib/ml/cliente.test.ts` (los 4 estados de `leerPromocionesItemMl`, 404 ya nunca se confunde con un fallo), `lib/trabajos/buscarPromocionesMultiCuenta.test.ts` (umbral de 403 → cuenta en error con el mensaje de reconectar; menos del umbral no la frena; 401/otro_error nunca la frenan por sí solos), `app/panel/promociones/resumenBusquedaVacia.test.ts` (cuándo se muestra el resumen vacío y su texto exacto por cuenta).

  Verificado: `npm run typecheck` en verde. `npx vitest run`: 1746 pruebas en verde, mismo baseline de 44 suites fallando solo por `DATABASE_URL_APP` ausente en este sandbox (sin regresión). `npm run build`: compila y tipa en verde; falla después en el mismo punto ya conocido (`DATABASE_URL_APP` ausente al recolectar datos de página).

  No se tocó `permisos_rol` ni la migración `0018`, ni ninguna migración nueva — este arreglo es código puro.
