- **2026-10-30** — **Bug real reportado por Mateo**: envíos que la transportadora ya recogió (`substatus` picked_up/dropped_off/out_for_delivery/at_the_door, o `status` shipped/delivered), pero que nadie marcó despachado en Seller, desaparecían por completo — Pendientes los excluye correctamente (ya salieron de la tienda), y la vieja pestaña "Despachados hoy" solo miraba `despachado_ts`, así que nunca los mostraba. Se renombra a **"Despachados"** y ahora muestra los últimos **15 días** (hora de Bogotá), agrupados por día (el más reciente arriba), con dos orígenes posibles por tarjeta:
  - **"Marcado en Seller"** — `despachado_ts` dentro de los 15 días.
  - **"Recogido por la transportadora"** — `substatus`/`status` confirman que ya salió, con `actualizado_ts` dentro de los 15 días, aunque `despachado_ts` siga null.
- **Causa raíz más profunda de lo reportado**: revisando la sincronización, `despachos_ml` SOLO se llenaba en la importación inicial (`lib/ml/importacion.ts`, una sola vez al conectar la cuenta) — cualquier venta que llegara después, por la sincronización periódica real (`sincronizarVentasCuenta`, el botón "Traer ventas de este mes" en Finanzas), nunca tenía fila en `despachos_ml` y por eso no podía aparecer en NINGUNA pestaña, sin importar su status. Se agrega la misma llamada a `sincronizarDespacho` (ya existente, pasa por `lib/ml/cliente.ts`) también en `sincronizarVentasCuenta` — mismo patrón que ya usaba la importación inicial en su propio punto de la sincronización.
- **Bug en `refrescarEstadoViejo` encontrado al revisar esta tarea**: su filtro de candidatos solo miraba el `status`, nunca `despachado_ts` — una fila que una persona YA marcó despachada, con `status` todavía sin refrescar, podía terminar excluida de Despachados si el refresco en vivo confirmaba que salió (el mismo evento que la persona ya había registrado a mano). Corregido: nunca se refresca ni se excluye una fila con `despachado_ts` ya puesto. Mismo ajuste en `backfillSlaFaltante` (por consistencia, no gastar una llamada de SLA en algo ya despachado).
- Filtros de cuenta y tipo aplican igual en Despachados (sin cambio — ya se pasaban antes del filtro por pestaña). Pendientes queda sin cambios.
- `rangoUltimosNDiasBogota` (nuevo, `lib/filtros-listado.ts`) — mismo criterio que `rangoDiaBogota`, para una ventana de varios días de calendario de Bogotá en vez de uno solo.
- Sin migración — `despachado_ts`/`status`/`substatus`/`actualizado_ts` ya existían. Sin tocar `lib/ml/cliente.ts` (las dos llamadas nuevas usan `sincronizarDespacho`, ya existente, que ya pasa por ahí).

## Pendiente — fuera de este PR
- Issue #49 (Refs) — esta sincronización sigue siendo manual/periódica ("Traer ventas del mes" en Finanzas), no por avisos/webhooks de Mercado Libre en tiempo real. Ese es el alcance real de #49 (cola de trabajos + "despachos por avisos"); este PR solo asegura que la sincronización que YA existe también llene `despachos_ml`, no agrega el mecanismo de avisos.

## Pruebas
- Un envío `picked_up` que nadie marcó en Seller aparece en Despachados como "Recogido por la transportadora".
- Un envío marcado despachado en Seller aparece como "Marcado en Seller".
- Uno de hace 16 días no aparece (fuera de la ventana); uno de hace exactamente 14 días sí (el borde no se corta de más).
- Aislamiento por empresa intacto; Full nunca aparece en Despachados aunque esté `delivered`.
- `sincronizarVentasCuenta` también sincroniza `despachos_ml` para la orden (antes solo lo hacía la importación inicial).
