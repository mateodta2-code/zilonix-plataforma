## Punto 1 — ¿ya existía la ruta de notificaciones?

**Sí, ya existía** (no se creó `app/api/ml/notificaciones/route.ts` — hubiera duplicado algo que ya funciona):

- **`app/api/ml/webhooks/route.ts`** — pública (`lib/rutas-publicas.ts`), recibe el POST de Mercado Libre, valida forma + `application_id` (contra `ML_CLIENT_ID`) + un tope real de 16KB leyendo el stream, y llama a `recibirAviso` (`lib/ml/avisos.ts`). Responde 200 siempre que el cuerpo venga bien formado — nunca procesa nada en la misma petición. **Ya cumplía los puntos 1 y 2 de la tarea.**
- **`lib/ml/avisos.ts`** (`recibirAviso`) — resuelve la empresa por el `user_id` (cuenta_ml real, con `dbComoAvisoWebhook`/RLS), y GUARDA el aviso en `avisos_ml` con `onConflictDoNothing` sobre `(cuenta_id_externa, topic, resource, enviado_ts)` — el mismo aviso exacto nunca se duplica. Si el `user_id` no es de ninguna cuenta nuestra, devuelve `"cuenta_desconocida"` sin guardar nada (ya lo ignoraba — se le agregó un `console.warn` para que quede registrado en los logs, punto 4 de la tarea).
- **`lib/ml/trabajador.ts`** (`procesarAvisosPendientes`) + **`app/api/ml/trabajador`** (ruta con secreto compartido, llamada cada minuto por `.github/workflows/trabajador-avisos-ml.yml`) — el trabajador real de la tarea 2.4. **Esto era lo que faltaba**: hasta este PR, "procesar" un aviso de `orders_v2`/`shipments` solo significaba "confirmar que el recurso es real y accesible" (un GET de verificación) — **nunca escribía en `pedidos` ni `despachos_ml`**. Por eso una venta nueva solo aparecía en Seller cuando corría la sincronización de cada hora, nunca al instante.

## Arreglo — puntos 2 a 5

- **`lib/ml/trabajador.ts`** — para los temas `orders_v2` y `shipments` (`TOPICS_VENTA`), `procesarUnAviso` ahora sí crea/actualiza `pedidos` y `despachos_ml`, con la MISMA lógica real de `sincronizarVentasCuenta` y el fix del PR #345 (nunca adivina el `shipmentId`: usa el que `guardarOrdenMl` ya resolvió del DETALLE real de la orden, nunca el contenido del aviso).
  - `orders_v2`: el `resource` del aviso YA es `/orders/{id}` — se pide ese pedido completo (`pedirLecturaMl`, `lib/ml/cliente.ts`) y se guarda con `guardarOrdenMl`; si `guardarOrdenMl` resolvió un `shipmentId`, se sincroniza el despacho (`sincronizarDespacho`).
  - `shipments`: el aviso no trae el pedido — se pide el ENVÍO real primero (únicamente para sacar el `order_id` real que trae Mercado Libre en ese recurso; nunca del contenido del aviso) y de ahí se sigue el mismo camino que `orders_v2`.
  - Cualquier otro tema (`items`, `payments`, `user_products`...) sigue con el comportamiento de siempre (solo confirma que el recurso es real) — fuera del alcance de esta tarea.
  - **Rate limiting** (punto 4): pausa chica (150 ms) entre un aviso y el siguiente del mismo lote — nunca una ráfaga de llamadas a Mercado Libre por los hasta 50 avisos de una corrida.
  - **Nunca se traga un 429** (punto 4): reintento con espera creciente (mismo `msDeReintento429`/`LimiteMercadoLibreError` que ya usa `sincronizarVentasCuenta`) alrededor de TODA la sincronización de un aviso — cubre las llamadas propias de esta función; `guardarOrdenMl` ya reintentaba las suyas por su cuenta.
  - **Idempotente** (punto 4): nunca un objeto a medias armado con el contenido del aviso — se pide el pedido COMPLETO antes de guardarlo (si esa lectura fallara, nunca se arriesga a guardar datos a medias con el respaldo silencioso de `guardarOrdenMl`). Procesar el mismo pedido/envío dos veces (dos avisos distintos de la misma orden, o el trabajador reintentando) nunca duplica nada — `pedidos`/`despachos_ml` ya tienen sus llaves únicas de siempre (`onConflictDoUpdate`).
- **Punto 5**: la sincronización de cada hora (`traerVentasDelMes`/`sincronizarVentasCuenta`) no se tocó — sigue como respaldo real si un aviso se pierde o Mercado Libre no llega a mandarlo.
- Sin migración — `avisos_ml`, `pedidos`, `despachos_ml`, `cuentas_ml` ya tenían todo lo necesario. Sin tocar `lib/ml/cliente.ts` ni `db/schema.ts`.

## Punto 7 — qué configurar en el DevCenter de Mercado Libre (lo hace Mateo, no Claude Code)

1. Entra a tu app de **staging** en [Mercado Libre Developers](https://developers.mercadolibre.com.co) (la misma que ya tiene el Client ID/Secret de staging) → sección **Notificaciones**.
2. En **"URL de notificaciones"**, pon la URL pública de staging de esta ruta (la misma que ya existe, no una nueva):
   `https://<tu-dominio-de-staging>/api/ml/webhooks`
3. En **"Tópicos"**, marca (como mínimo, para esta tarea):
   - `orders_v2`
   - `shipments`
4. Guarda. Mercado Libre va a mandar un aviso de prueba a esa URL — si tu app de staging está desplegada y corriendo, debería responder 200 solo.
5. No hace falta nada más de tu parte en Railway — `ML_CLIENT_ID` (para validar que el aviso es de tu app) y `TRABAJADOR_SECRET` (para el cron) ya están puestos de antes.

## Pruebas
- `lib/ml/trabajador.test.ts`:
  - Describe original (tema `items`, no `orders_v2`/`shipments`): sigue probando el comportamiento de siempre (solo confirma que el recurso es real), sin cambios de fondo — solo se cambió el tema de los fixtures para no pisar el describe nuevo.
  - Describe nuevo: un aviso `orders_v2` de una orden nueva crea el pedido Y su despacho, con el `shipmentId` resuelto por `guardarOrdenMl` (no adivinado); un aviso `shipments` resuelve el `order_id` real del envío y sincroniza lo mismo; dos avisos de la MISMA orden (creada y actualizada) nunca duplican el pedido ni el despacho.
- **"user_id desconocido se ignora"**: ya estaba cubierto por `db/rls-avisos-ml.test.ts` (prueba real contra Postgres, tarea 2.4: "uno de una cuenta desconocida se descarta") — no se duplicó esa prueba.
