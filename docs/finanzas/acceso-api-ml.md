# Acceso a la API de Mercado Libre para Finanzas (Fase 1)

Issue #122 (Z-FIN-00). Este documento dice **qué tiene que leer Zilonix Seller de Mercado Libre** para la Fase 1 de finanzas, con qué endpoint y qué campos, y **qué tan seguro es cada dato**. Sin tokens, sin montos ni datos reales.

Estados que se usan abajo:

- **Confirmado por Zilonix OS**: el código del OS lo usa hoy en producción. Es referencia, **no prueba** de que la app de Seller (otra app de ML, con sus propios permisos) tenga el mismo acceso. Igual hay que ratificarlo en staging.
- **Por verificar en staging**: ni el OS ni este repo lo usan todavía. Sale de la documentación oficial de Mercado Libre Developers (enlace en la fila) y lo tiene que confirmar Mateo con una cuenta real (Parte 2).

## 1. Qué lee hoy la app (antes de este issue)

| Archivo | Llamada a ML | Qué usa |
|---|---|---|
| `lib/ml/oauth.ts` | `POST /oauth/token` (código + PKCE, y renovación con `refresh_token`); `GET /users/me` | `access_token`, `refresh_token`, `expires_in`, `user_id`; `nickname` |
| `lib/ml/cuentas.ts` | ninguna directa | Guarda los tokens cifrados (`cuentas_ml`) y los renueva con candado (`obtenerAccessTokenVigente`) |
| `lib/ml/importacion.ts` | `GET /orders/search?seller=…` (60 días), `GET /shipments/{id}`, `GET /users/{id}/items/search`, `GET /items?ids=…` | Orden: `id`, `date_created`, `status`, `total_amount`, `currency_id`, `payments[].status`, `payments[].date_approved`, `shipping.id`. Envío: `status`, `status_history.date_shipped/date_delivered` |
| `lib/ml/despachos.ts` | `GET /shipments/{id}`, `GET /shipment_labels` | `status`, `substatus`, `logistic_type` |
| `lib/ml/cliente.ts` | Catálogo público (`/products/...`, `/highlights/...`, `/users/{id}`) | Solo para Investigación ML |

**Permisos**: `construirUrlAutorizacion` no pide scopes explícitos; ML los toma de la configuración de la app en el panel de desarrolladores (igual que en el OS). La documentación oficial muestra tokens con `"scope": "offline_access read write"` y una vida de 6 horas (`expires_in: 10800` en el ejemplo, ver [Autenticación y Autorización](https://developers.mercadolibre.com.co/es_ar/autenticacion-y-autorizacion)). Lo que **no** sabemos es si los "permisos funcionales" de la app de Seller incluyen facturación, reclamos y publicidad: eso es justamente lo que mide el script.

Nada de lo de hoy lee **comisión**, **costo de envío**, **liberación del pago**, **reclamos** ni **publicidad**.

## 2. Tabla de capacidades (a–f)

La (g) retenciones (retefuente, reteICA) queda **fuera de la Fase 1**.

| # | Capacidad | Endpoint | Campos esperados | Estado | Documentación oficial |
|---|---|---|---|---|---|
| a | Token vigente o reconectable | `POST /oauth/token`; comprobación con `GET /users/me` | `access_token`, `refresh_token`, `expires_in`, `user_id`, `scope` | **Confirmado por Zilonix OS** (y ya en uso en Seller). Por verificar en staging: que las 16 + 5 cuentas estén conectadas a la app de Seller | [Autenticación y Autorización](https://developers.mercadolibre.com.co/es_ar/autenticacion-y-autorizacion) |
| b | Detalle de orden, SKU y comisión | `GET /orders/search?seller={id}`; `GET /orders/{id}`; si el SKU viene vacío, `GET /items/{id}` | `order_items[].item.id`, `order_items[].item.seller_sku`, `order_items[].sale_fee`, `payments[].status`, `payments[].date_approved`, `payments[].marketplace_fee`. Comisión = suma de `marketplace_fee` de los pagos aprobados **del detalle** (el listado la trae vacía). `seller_custom_field` no se usa | **Confirmado por Zilonix OS**; ratificar en staging. ⚠️ Qué campo de `/items/{id}` usa el OS como respaldo del SKU no está escrito en el issue: **por verificar** | [Órdenes](https://developers.mercadolibre.com.co/es_ar/gestiona-ventas) |
| c | Forma de entrega y costo de envío | `GET /shipments/{id}`; `GET /shipments/{id}/costs`; `GET /shipments/{id}/sla` | `logistic_type` (`fulfillment`, `self_service`, `cross_docking`, `xd_drop_off`, `drop_off`); costo real = suma de `cost` de `/costs` (nunca el campo del pago, que da 0). Flex: costo ML = $0 (ML lo revierte) | **Confirmado por Zilonix OS**; ratificar en staging. ⚠️ Las rutas exactas de `cost` dentro de `/costs` (`senders[].cost`, `receiver.cost`) son **por verificar**: el script nombra las llaves conocidas que llegan y cuenta las demás | [Envíos](https://developers.mercadolibre.com.co/es_ar/envios) · [Costos de envío](https://developers.mercadolibre.com.co/es_ar/costos-de-envios) |
| d | 🔴 Fecha y estado de liberación del pago | `GET /billing/integration/group/ML/order/details?order_ids={id}` (hasta 60 órdenes por llamada) | `results[].payment_info[].money_release_date`, `money_release_status` (`released` en el ejemplo oficial), `money_release_days`, `date_approved`, `payment_id` | **Visto en el piloto de staging (2026-10-27, sección 4)**: HTTP 200 y llegaron `money_release_date`, `money_release_status` y `money_release_days` (muestra `pending`). No existe en el OS. Siguen pendientes un `released` real y la corrida de las 21 cuentas | [Provisiones](https://developers.mercadolibre.com.co/es_ar/provisiones) |
| e | Reembolsos, reclamos y devoluciones | Reembolsos: detalle de la orden (`GET /orders/{id}`). Reclamos: `GET /post-purchase/v1/claims/search?players.user_id={id}&players.role=respondent`, `GET /post-purchase/v1/claims/{id}`. Devoluciones: `GET /post-purchase/v2/claims/{id}/returns` | Orden: `status` (incluye `partially_refunded`), `payments[]`. Reclamo: `id`, `resource_id`, `status`, `type`, `stage`. Devolución: `id`, `shipments[]`, estado | Reembolsos: **confirmado por Zilonix OS** (los descuenta del monto). El piloto del 2026-10-27 vio `transaction_amount_refunded` y `status` en la orden (sección 4); ese campo no aparece en la página oficial de Órdenes. `GET /post-purchase/v1/claims/search` respondió HTTP 400 y no hubo muestra de reclamo. Reclamos y devoluciones **como ajuste financiero**: **por verificar** (el OS los tiene en un buzón aparte, sin efecto en cálculos) | [Órdenes](https://developers.mercadolibre.com.co/es_ar/gestiona-ventas) · [Reclamos](https://developers.mercadolibre.com.co/es_ar/que-es-un-reclamo) · [Devoluciones](https://developers.mercadolibre.com.co/es_ar/gestionar-devoluciones) |
| f | Publicidad (Product Ads) por cuenta y día | `GET /advertising/advertisers?product_id=PADS` (encabezado `Api-Version: 1`); `GET /advertising/MCO/advertisers/{advertiser_id}/product_ads/campaigns/search?date_from=D&date_to=D&metrics=cost` (encabezado `api-version: 2`) | `advertisers[].advertiser_id`, `advertisers[].site_id`; `results[].metrics.cost`. Se pide **día por día** (el OS lo hace así). La doc permite hasta 90 días hacia atrás y dice que las métricas se actualizan a las 10:00 GMT-3 | **Confirmado por Zilonix OS**; el piloto (sección 4) vio `advertisers` y `campaigns/search` en OK. ⚠️ **IVA**: según el OS la API trae el costo **sin IVA** (el OS suma 19 % al resumen mensual); la documentación oficial no lo dice, y el piloto confirmó que la API no indica IVA. Comparar un día contra la factura de ML **sigue pendiente** | [Product Ads (lectura)](https://developers.mercadolibre.com.co/es_ar/product-ads-para-catalogo-y-user-products-lectura) |

### Notas sobre la tabla

- **Forma de entrega (`logistic_type`)**: Mateo confirmó (2026-10-23) la decisión de producto para la **Fase 1 de finanzas**. Agencia = `cross_docking` + `xd_drop_off` + `drop_off`; Full = `fulfillment`; Flex = `self_service`. El CHANGELOG de la tarea 2.10 y el comentario de `db/schema.ts` todavía llaman Places a `xd_drop_off` y Colecta a `cross_docking`; esa nomenclatura de despachos no cambia esta decisión. Caveat técnico: `logisticTypeEnum` en `db/schema.ts` sigue sin `drop_off`, y `lib/ml/despachos.ts` lo guardaría como `otro`. Alinear el enum es un seguimiento antes de #129; este cambio no trae migración. La forma de entrega **no** se deduce del prefijo del SKU (FUL, IMP, UNM).
- **Nombres y cifras en issues**: Mateo autorizó nombrar las empresas (Zilonix, Pachamama, Infinity) y citar cifras de costo en issues de este repo público cuando haga falta para el trabajo de finanzas. Este documento no pega montos.
- **Límites (429)**: la documentación oficial ([Rate Limit / Error 429](https://developers.mercadolibre.com.co/es_ar/rate-limit-error-429)) dice que el límite se aplica principalmente **por aplicación (Client ID)**, no por cuenta, y recomienda **backoff exponencial con jitter** y bajar la concurrencia. Con 21 cuentas contra la misma app, Seller necesita reintentos (el OS no los tiene). Propuesta para #123, #130, #133 y #135: hasta 3 reintentos con espera de 1 s, 2 s y 4 s (+ hasta 30 % al azar), una cuenta a la vez, y registrar cada 429 (cuenta, endpoint, hora). El número fino sale de lo que mida el script.
- **Saldos ML**: no vienen de la API en el OS (carga manual) y quedaron fuera de la Fase 1.
- El piloto (sección 4) ya vio la (d) en HTTP 200. Si la corrida de las 21 cuentas no lo repite, **no** se construyen #132 y #133 sin avisar antes a Sharel. Plan alternativo a evaluar: el reporte de facturación por período (`/billing/integration/periods/key/{periodo}/group/MP/details`, misma página de Provisiones) o la consulta del pago en Mercado Pago — ninguna de las dos está probada.

## 3. Cómo se verifica (Parte 2, Mateo en staging)

Script: `scripts/finanzas/verificar-acceso-ml.ts`. Es **de solo lectura**:

- Toda llamada a ML pasa por `leerParaDiagnostico()` de `lib/ml/cliente.ts`, que **solo hace GET** y rechaza cualquier ruta que no sea relativa a `api.mercadolibre.com`.
- Solo lee `cuentas_ml` con `dbComoEmpresa()`. **No renueva tokens** (renovar escribe en la base y gasta el `refresh_token`, que ML deja usar una vez): si un token está vencido, la celda dice "token vencido".
- Imprime estados, códigos HTTP, tiempos y **nombres** de campos con sí/no. Nunca tokens, montos, ids de órdenes ni datos de compradores. `logistic_type` y `money_release_status` solo salen si están en una lista conocida; si no, salen como "(valor nuevo)".
- Mide por cuenta: número de llamadas, respuestas 429, tiempo total y la llamada más lenta. Ante un 429 reintenta con backoff (1 s, 2 s, 4 s).
- Cada cuenta sale solo como **"Cuenta N"** (por fecha de conexión, de la más antigua a la más nueva), nunca con el nickname de la tienda: este repo es público y la tabla se pega acá.
- De `/shipments/{id}/costs` solo nombra las llaves de una lista cerrada (`senders`, `receiver`, `gross_amount`, `save`); las demás se cuentan ("+N no conocida(s)") sin imprimir su nombre.
- No corre sin `CONFIRMO_SOLO_LECTURA=si` ni sin `AMBIENTE_CONFIRMADO=staging`. Al arrancar muestra solo el **host** de `DATABASE_URL_APP` (nunca usuario ni clave), para confirmar contra qué base corre antes de leer nada.

Antes de correrlo:

1. Túnel privado a la base de staging (`railway connect <servicio-postgres> --tunnel-only`), nunca el proxy público.
2. En la terminal (no en un chat ni en un archivo del repo): `DATABASE_URL_APP` apuntando al túnel con `app_user`, `ML_TOKEN_KEY_V1` de staging, `EMPRESA_ID` (UUID de la empresa Zilonix; luego la de Pachamama).
3. Renovar antes los tokens vencidos con `obtenerAccessTokenVigente` (o cualquier flujo que toque la API de ML). Abrir `/panel/pedidos` solo no renueva: esa pantalla lee la base y no llama a Mercado Libre. El script tampoco renueva.

Comando:

```bash
CONFIRMO_SOLO_LECTURA=si AMBIENTE_CONFIRMADO=staging EMPRESA_ID=<uuid-de-la-empresa> npx tsx scripts/finanzas/verificar-acceso-ml.ts
```

`MUESTRA_PEDIDOS` (1–10, por defecto 3) cambia cuántas órdenes recientes por cuenta se miran para juntar valores de `logistic_type`.

Qué hacer con cada resultado:

| Estado | Causa probable | Siguiente paso |
|---|---|---|
| OK | — | Anotar los campos que llegaron |
| falta permiso (401/403) | La app de Seller no tiene ese permiso funcional, o la cuenta no autorizó | Revisar permisos de la app en ML Developers y reautorizar la cuenta |
| no disponible (404, o 200 sin el campo clave) | El recurso no existe para esa cuenta/país o el campo no llega | Anotar; si es la (d), avisar a Sharel antes de #132/#133 |
| sin muestra | La cuenta no tiene órdenes (ventas), reclamos o anunciante para probar — en la (e), sin ventas de muestra el estado es este, no "error" | Repetir con una cuenta que sí tenga |
| token vencido / desconectada | El token pasó sus 6 horas, o la cuenta se desconectó | Renovar con `obtenerAccessTokenVigente` (tocar la API de ML; abrir `/panel/pedidos` no alcanza). Si está desconectada, reconectarla en `/panel/conectar-ml` |
| limitado (429) | Límite por aplicación | Anotar cuántos y cuándo; insumo para el backoff de #123/#130/#133/#135 |

## 4. Resultado en staging

La corrida completa — 16 cuentas de Zilonix y luego las 5 de Pachamama — **sigue pendiente** (Mateo). Lo de abajo es solo el piloto.

### Piloto 2026-10-27 (3 cuentas)

Empresa piloto en staging, 3 cuentas ML (1 desconectada y 2 con token vigente). Script: `scripts/finanzas/verificar-acceso-ml.ts`. Antes de la corrida se renovaron los tokens con `obtenerAccessTokenVigente`: abrir `/panel/pedidos` solo no los renueva.

Solo "Cuenta N". La correspondencia N → tienda queda fuera del repo.

| Cuenta | (a) token | (b) orden+SKU+comisión | (c) envío | (d) liberación pago | (e) reclamos/devol. | (f) publicidad | llamadas | 429 | ms total | ms máx |
|---|---|---|---|---|---|---|---|---|---|---|
| Cuenta 1 | desconectada | sin muestra | sin muestra | sin muestra | sin muestra | sin muestra | 0 | 0 | 0 | 0 |
| Cuenta 2 | OK | OK | OK | OK | error | OK | 15 | 1 | 1632 | 426 |
| Cuenta 3 | OK | OK | OK | OK | error | OK | 14 | 0 | 1456 | 423 |

Totales del piloto: **29 llamadas, 1×429, 3088 ms**.

Qué ya respondió este piloto:

- **(d)** `GET /billing/integration/group/ML/order/details` respondió HTTP 200. Llegan `money_release_date`, `money_release_status` y `money_release_days`. El estado de la muestra fue `pending`.
- **(e)** La orden trae `transaction_amount_refunded` y `status`. `GET /post-purchase/v1/claims/search` respondió HTTP 400. No hubo muestra de reclamo.
- **(f)** `advertisers` y `product_ads` `campaigns/search` respondieron bien. La API no indica si el costo trae IVA.
- **`logistic_type` vistos:** `xd_drop_off` y `fulfillment`. Ningún valor nuevo en esta muestra.

Sigue abierto para la corrida de las 21 cuentas:

- [x] De dónde sale la fecha de liberación (d). El piloto lo vio: HTTP 200 y los tres campos; la muestra salió `pending`.
- [ ] Cómo se sabe que un pago ya se liberó (`money_release_status` = `released`). En el piloto no apareció: solo `pending`.
- [ ] Tiempos y 429 con la carga de 21 cuentas. El piloto (3 cuentas) midió 29 llamadas, 1×429 y 3088 ms; no alcanza para fijar el backoff de #123, #130, #133 y #135.
- [ ] Publicidad: costo sin IVA, por día y cuenta, comparado contra la factura. El piloto solo confirmó que la API no indica IVA.
- [x] `logistic_type` vistos en el piloto: `xd_drop_off` y `fulfillment`, sin valor nuevo.
- [ ] `logistic_type` por cuenta en las 21.
- [ ] SKU desde `seller_sku` o `/items/{id}`, con ejemplo por cuenta (sin datos reales). En el piloto la (b) salió OK en las dos cuentas con token; no quedó anotado de qué campo salió el SKU.
- [ ] Qué cuentas hay que reautorizar y cuáles reciben avisos en otra app de ML. El piloto solo vio 1 desconectada y 2 con token vigente.
