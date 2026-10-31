## Diagnóstico (solo lectura, staging)

Bug reportado por Mateo: orden `2000019256696110` (cuenta STOREKINGSAS, empresa sharel) en `ready_to_ship` en Mercado Libre, creada el 30/10 6:09 p. m. Bogotá — pero `/panel/despachos` Pendientes aparecía vacío.

1. **La orden SÍ está en `pedidos`** (fecha exacta: `2026-10-30T23:09:24Z` = 6:09 p. m. Bogotá), con `estado='paid'`, y `pedidos_finanzas` tiene su foto financiera completa (`forma_entrega='agencia'`, `valor_venta='128000.00'`) — la sincronización SÍ la trajo y SÍ le resolvió el envío/costos bien. **Pero no tiene ninguna fila en `despachos_ml`.**
2. **La cuenta STOREKINGSAS está conectada** en la empresa sharel, `desconectada_ts` null, token vigente hasta `2026-10-31T06:24:39Z`. Hubo DOS corridas de `sincronizarVentasCuenta` después de creada la orden (`00:28:22Z` y `01:34:37Z`, auditoría: "Ventas leídas 178, guardadas 178... con error 0" las dos veces) — ninguna le creó la fila.
3. La orden SÍ está (no aplica el diagnóstico de "por qué no la trajo la sync").
4. **No es un filtro de Pendientes** (SUBESTADOS_YA_SALIO, despachado_ts, cuenta/tipo, Flex/Agencia) — sin fila en `despachos_ml`, ningún filtro de `listarTarjetasDespacho` llega siquiera a evaluarse para esta orden.

**Causa real, confirmada (no un percance de Mercado Libre — no es, por ejemplo, "shipping.id tarda en aparecer"):** no es un caso aislado — **48 de 250 pedidos** de esta misma cuenta no tienen fila en `despachos_ml`, repetido IDÉNTICO en corridas de sincronización separadas por horas y días (nunca se autocorrige solo, lo que descarta una demora de Mercado Libre en generar el envío). El código real (`sincronizarVentasCuenta`, `lib/ml/ventas-finanzas.ts`) decidía si llamar a `sincronizarDespacho` mirando `orden.shipping?.id` — pero esa variable `orden` es la del LISTADO (`/orders/search`), y `guardarOrdenMl` la reemplaza LOCALMENTE por la del DETALLE (`GET /orders/{id}`, donde sí se resuelve bien el shipmentId — por eso la foto financiera de esta venta salió perfecta) sin que ese cambio se vea afuera de la función: son dos objetos distintos, y el llamador seguía mirando el que no sirve.

## Arreglo

- `guardarOrdenMl` ahora devuelve el `shipmentIdExterno` que de verdad resolvió (el del DETALLE) — `ResultadoGuardarOrdenMl`, `lib/ml/ventas-finanzas.ts`.
- `sincronizarVentasCuenta` usa ese valor (`guardada.shipmentIdExterno`) para decidir si llama a `sincronizarDespacho`, en vez de `orden.shipping?.id` (la orden del listado). Mismo `sincronizarDespacho` de siempre, mismo `lib/ml/cliente.ts` por debajo — cero llamadas nuevas a Mercado Libre.
- `lib/ml/importacion.ts` (importación inicial, una sola vez al conectar la cuenta) tiene el MISMO patrón (`pedido.shipping?.id` de su propio listado) — no se tocó en este PR (alcance: la sincronización periódica, que es la que está activa y rompiendo hoy); queda anotado para una tarea aparte si Mateo la pide.
- **"Sincronizar ahora"** (pedido condicional de la tarea): botón nuevo en Pendientes que llama a `traerVentasDelMes` (la misma función de Finanzas → "Traer ventas de este mes") sin salir de Despachos — para traer una venta nueva al instante en vez de esperar a que alguien sincronice desde otra pantalla. Mismo permiso que ya exige esa función (`finanzas`/`modificar`); solo se muestra en Pendientes, a quien tenga ese permiso.
- Sin migración, sin tocar `lib/ml/cliente.ts` ni `db/schema.ts`.

## Cómo reaparece la venta de Mateo

Con el fix en producción, la próxima vez que alguien aprete "Traer ventas de este mes" (Finanzas) o "Sincronizar ahora" (Despachos) para la cuenta STOREKINGSAS, la orden `2000019256696110` (y las otras 47 que tenían el mismo problema) consigue su fila en `despachos_ml` y aparece en Pendientes — no hace falta ninguna reparación manual de datos.

## Pruebas
- `lib/ml/ventas-finanzas.test.ts` — reproduce exactamente el bug real: el listado (`/orders/search`) sin `shipping.id`, el detalle (`GET /orders/{id}`) con él; confirma que `despachos_ml` se sincroniza igual, con el shipmentId correcto.
- `app/panel/despachos/actions.test.ts` — `sincronizarAhoraAction`: llama a `traerVentasDelMes` con la empresa/usuario de la sesión y todas las cuentas conectadas; junta el resumen; sin cuentas conectadas da un error claro; sin permiso devuelve el mensaje real (nunca un 500 crudo).
- `app/panel/despachos/SincronizarAhoraCliente.test.tsx` — muestra el resumen y refresca la página al éxito; muestra el error y no refresca al fallar.
