# WMS Fase 1 — Bodegas, stock y kardex (issue #280)

Seller es la fuente de verdad del inventario (no Fulfy). Esta página resume cómo quedó armado, qué se supuso y qué falta. La spec completa original (`seller-wms-fase1-bodegas-stock-kardex.md`, chat Pablo / Logix del 2026-10-28) **no está en el repo**: se construyó sobre el resumen del issue #280.

## Modelo

| Tabla | Para qué | `app_user` |
|---|---|---|
| `bodegas` | Bodegas de la empresa (`propia`, `fulfillment_ml`, `tercero`), una principal | SELECT, INSERT, UPDATE |
| `stock_bodega` | Saldo por SKU × bodega: `disponible`, `reservado`, `en_transito` (enteros, CHECK ≥ 0) | SELECT, INSERT, UPDATE |
| `kardex_movimientos` | Append-only: delta y saldo después de cada movimiento | SELECT, INSERT (sin UPDATE ni DELETE) |
| `ordenes_compra` / `orden_compra_items` | OC simple con consecutivo por empresa | SELECT, INSERT, UPDATE |
| `recepciones` / `recepcion_items` | Lo que llegó, contra OC o directo | SELECT, INSERT |
| `configuracion_inventario` | Regla y umbral de última unidad, `buffer_ml`, envío a ML, inicio de reservas | SELECT, INSERT, UPDATE |
| `sync_stock_ml` | Cola con espera del envío a ML, y último resultado por SKU | SELECT, INSERT, UPDATE |
| `alertas_ultima_unidad` | Banner Aplicar / No aplicar | SELECT, INSERT, UPDATE |

Todas tienen `empresa_id` + RLS (`db/rls-setup.sql`) y FK compuestas `(empresa_id, …)`: una fila de A nunca apunta a una bodega o un SKU de B. Para eso `skus` gana `UNIQUE (empresa_id, id)` en su propia migración (`0015_skus_empresa_id_unica`): drizzle-kit la dejaba al final de la `0016`, después de las FK que la necesitan, y la migración habría fallado.

`configuracion_inventario`, `sync_stock_ml` y `alertas_ultima_unidad` no están en la lista de entidades del issue. Se agregaron porque la config de la empresa, el debounce del sync y el banner necesitan estado guardado.

## Una sola puerta

`lib/inventario/movimientos.ts` → `aplicarMovimientos` / `aplicarMovimientosTx`. Nada más escribe `stock_bodega`. Cada operación:

1. es idempotente por `clave_idempotencia` (`manual:<uuid del formulario>`, `recepcion:<id>`, `pedido:<id>:reserva|confirmacion|liberacion`);
2. valida SKU (los kits no tienen stock propio) y bodegas (una desactivada no recibe);
3. bloquea las filas de saldo en orden fijo (`FOR UPDATE`) y aplica todo o nada;
4. escribe el kardex, marca el SKU (y los kits que lo usan) en `sync_stock_ml` y revisa la última unidad.

| Tipo | disponible | reservado |
|---|---|---|
| entrada | + | |
| salida | − | |
| ajuste | ± | |
| traslado | − origen / + destino (instantáneo) | |
| reserva | − | + |
| liberacion | + | − |
| confirmacion | | − |

## Pedidos de ML

`lib/inventario/pedidos-ml.ts`, llamado desde `guardarOrdenMl` (`lib/ml/ventas-finanzas.ts`) después de guardar la venta. Un fallo del inventario no tumba la venta.

- Apagado por defecto. Al prenderlo en Configuración se guarda `reserva_pedidos_desde_ts`, y **solo los pedidos creados después** mueven stock. Sin esto, la importación inicial (60 días ya despachados) descontaría unidades que salieron antes de contar.
- Kits → se expanden a sus componentes.
- Rechazo total: si una línea no tiene SKU propio o el pedido no alcanza entero en una sola bodega (principal primero), no se reserva nada y queda en auditoría (una vez por pedido).

## Envío a ML

`lib/trabajos/sincronizarStockMl.ts`. Cantidad = `max(0, disponible de las bodegas que suman al publicado − buffer_ml)`, y para un kit, cuántos se arman. Apagado por defecto. Espera de 60 s por SKU. Hoy se dispara con el botón "Sincronizar ahora" de `/panel/inventario/configuracion`. Escribe con `actualizarItemMl` (`PUT /items/{id}` con `available_quantity`, el mismo cuerpo que ya usa `zilonix-os/lib/inventario-recompras.js`), sin tocar `lib/ml/cliente.ts`.

## Supuestos (preguntas abiertas del issue — confirmar con Mateo/Franky)

1. **Estado que dispara la reserva**: `status = paid` de la orden. Confirma con `pedidos_finanzas.fecha_despacho`. Libera con `pedidos_finanzas.cancelada` (cancelled o reembolso total).
2. **Traslado**: instantáneo. `en_transito` existe en la tabla y en el kardex, siempre en 0, listo para la 1.1.
3. **available_quantity = 0 vs pausar**: se manda 0, no se pausa a mano. Sin confirmar con un caso real.
4. **API de promociones**: no se usa. "Aplicar" en el banner solo registra que la persona quitó la promo a mano en ML. En Zilonix OS, sacar un ítem de una campaña (`DELETE /seller-promotions/items/{id}`) nunca se usó en producción (`lib/inventario-recompras.js`, `quitarPromocion`). Automatizarlo pide confirmar con un caso real y agregar la llamada a `lib/ml/cliente.ts`, que hay que avisar antes de tocar.
5. **Bodega `fulfillment_ml` automática al conectar Full**: no se crea sola. Se crea a mano con tipo "Full de Mercado Libre", nunca es principal y nace sin sumar a lo publicado.

## Gaps conocidos (fuera de este PR)

- **Cron para todas las empresas**: necesita su propio usuario de base, como `publicidad_trabajador_user`, más un workflow. Hoy el envío solo corre desde el botón.
- **Publicaciones Full y con variaciones** no se envían. Variaciones pide mapear cada variación a su SKU. Full + bodega va por `/user-products/{id}/stock`, sin confirmar en Colombia.
- **El trabajador de avisos** (`lib/ml/trabajador.ts`) todavía no guarda la orden. Las reservas pasan cuando la venta entra por `guardarOrdenMl`: importación inicial o `sincronizarVentasCuenta`, cuya cola es el #49.
- **Devoluciones**: lo confirmado no vuelve solo. Se registra como entrada o ajuste.
- **Permiso `inventario.autorizar`** (configuración y envío a ML): está en Dueño y Gerente. No se marcó como peligroso en `lib/roles-plantillas.ts`. Decidir si debe estarlo.
