# Investigación: API oficial de Mercado Libre para Product Ads, comisiones y envíos

Fecha de la investigación: 26/10/2026 (hora de Bogotá). Fuentes: la documentación oficial de Mercado Libre Developers, leída en vivo, y el código del repo. Leyenda:

- ✅ **Verificado**: aparece literalmente en la doc oficial citada.
- 🟡 **Parcial**: está documentado, pero no para MCO/sitio local, o la doc es ambigua.
- ❌ **No verificado**: no lo encontré en la doc oficial. Hay que probarlo en staging o preguntárselo a Mercado Libre. **No se debe construir sobre esto como si fuera un hecho.**

## 0. Fuentes (URLs exactas)

| # | Doc | URL | Última actualización (según la página) |
|---|---|---|---|
| F1 | Product Ads para Catálogo y User Products (lectura, sitio CO). **Fuente principal** | https://developers.mercadolibre.com.co/es_co/product-ads-para-catalogo-y-user-products-lectura | 19/10/2026 |
| F2 | Product Ads for Catalog and User Products (Global Selling): **la única que documenta escritura** (crear y modificar campaña) | https://global-selling.mercadolibre.com/devsite/manage-sales-global-selling/new-product-ads | 16/10/2026 |
| F5 | Permisos funcionales (scopes, permiso "Publicidad") | https://developers.mercadolibre.com.co/es_co/permisos-funcionales | 04/03/2026 |
| F6 | Autenticación y autorización (OAuth, refresh token) | https://developers.mercadolibre.com.co/es_co/autenticacion-y-autorizacion | 15/07/2026 |
| F7 | FAQ Rate limit / Error 429 | https://developers.mercadolibre.com.co/es_co/rate-limit-error-429 | 05/05/2026 |
| F8 | Costos por vender (`listing_prices`, `sale_fee`) | https://developers.mercadolibre.com.co/es_co/comision-por-vender | 03/09/2026 |
| F9 | Costos de envíos (`shipping_options/free`, `items/{id}/shipping_options`) | https://developers.mercadolibre.com.co/es_co/costos-de-envios | 13/02/2026 |
| F10 | FAQ Mercado Envíos: costos y cotizaciones (`/shipments/{id}/costs`) | https://developers.mercadolibre.com.co/es_co/mercado-envios-costos-y-cotizaciones | 05/05/2026 |
| F11 | API de precios (`/items/{id}/sale_price`) | https://developers.mercadolibre.com.co/es_co/api-de-precios | 14/10/2026 |
| F12 | Introducción a Mercado Ads | https://developers.mercadolibre.com.co/es_co/introduccion-a-mercado-ads | 05/08/2024 |

Nota: también leí una versión anterior de la página en inglés (actualizada el 30/12/2025). Usa los endpoints legados que ya se desactivaron, así que no la cito como fuente: solo la usé para contrastar el glosario. El buscador también indexa `https://developers.mercadolibre.com.co/es_co/pads-read`, pero el HTML vino vacío (solo el pie de página). Usé F1, que tiene el mismo contenido y es la página vigente.

Precedente en código propio: `mateodta2-code/zilonix-os` → `lib/ads-ml.js` (en producción) ya llama a `GET /advertising/advertisers?product_id=PADS` y a `GET /marketplace/advertising/{site_id}/advertisers/{advertiser_id}/product_ads/campaigns/search` con `Api-Version: 1`, `metrics_summary=true` y un día a la vez. Ese prefijo `/marketplace` y la versión 1 **no coinciden** con la doc local vigente (F1 usa `/advertising/...` con `api-version: 2`). Ver §8.

---

## 1. Requisitos de acceso: scopes, permisos y aprobación de la app

| Tema | Hallazgo | Estado | Fuente |
|---|---|---|---|
| Permiso funcional de la app | La app de ML Developers tiene que tener activo el permiso funcional **"Publicidad"** ("permite su aplicación acceder, crear y gestionar campañas de publicidad. Permite el acceso a los recursos de Advertising"). Recursos relacionados: Product Ads, Brand Ads, Display. | ✅ | F5 |
| Scopes | "Solo lectura" = métodos GET. "Lectura y escritura" = PUT, POST y DELETE. Para Fase 4 (modificar campañas) hace falta lectura **y escritura** en el permiso Publicidad. | ✅ | F5 |
| Error si falta el permiso | `403` con `{"code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES","blocked_by":"PolicyAgent",...}`. La doc dice que se arregla habilitando el permiso funcional en la configuración de la app. | ✅ | F5 |
| Scopes OAuth del token | Valores válidos: `offline_access`, `read`, `write`. El ejemplo de respuesta trae `"scope": "offline_access read write"`. | ✅ | F6 |
| Refresh token | Es de un solo uso: cada renovación devuelve uno nuevo. El repo ya lo maneja con un candado (`cuentas_ml.renovando_ts`). | ✅ | F6 |
| Duración del access token | El texto dice "expirará transcurridas 6 horas", pero el ejemplo trae `expires_in: 10800` (3 h). **Usar siempre `expires_in` de la respuesta.** | 🟡 inconsistente en la doc | F6 |
| Aprobación o certificación de Mercado Libre para usar Advertising | **No encontré ningún proceso de revisión o certificación** para el permiso Publicidad. Solo se activa en el DevCenter. | ❌ no verificado | F5 |
| ¿Hay que reautorizar los tokens existentes después de activar el permiso? | No está documentado. Si llega el 403 de PolicyAgent con el permiso ya activo, pedirle al vendedor que reconecte. | ❌ | — |
| Requisitos del **vendedor** | Reputación amarilla o mejor; al menos 15 días registrado; mínimo de ventas (1 si es empresa, 10 si es persona); ninguna factura vencida. | ✅ (F2; F1 no lo repite) | F2 |
| Vendedor sin Product Ads activo | `GET /advertising/advertisers` responde `404 "No permissions found for user_id"`. El vendedor tiene que entrar a Mercado Libre > Mi perfil > Publicidad. | ✅ | F1 |

Contexto del repo: la app nueva ("Zilonix Plataforma", `ML_CLIENT_ID`) **es distinta** de la de Zilonix OS. Que Zilonix OS ya lea Product Ads no garantizaba, al escribir esta investigación, que la app nueva tuviera activo el permiso. **Confirmado después (26/10/2026, equipo):** en el DevCenter de la app Zilonix Plataforma el permiso "Publicidad de un producto" está activo en lectura y escritura, y la cuenta piloto MTTIENDA se reconectó en Seller después de activarlo. Un token emitido antes de ese permiso puede seguir respondiendo 403 hasta que se reconecte.

---

## 2. Endpoints de Product Ads: lectura (vigentes en F1, sitio CO)

Cabeceras: `Authorization: Bearer $ACCESS_TOKEN` y `api-version: 2`. La excepción es advertisers, que usa `Api-Version: 1`.

| Para qué | Método y ruta | Estado | Fuente |
|---|---|---|---|
| Anunciante (advertiser) | `GET https://api.mercadolibre.com/advertising/advertisers?product_id=PADS`. Devuelve `advertisers[]` con `advertiser_id`, `site_id`, `advertiser_name`, `account_name`. | ✅ | F1 |
| Listar campañas | `GET /advertising/{ADVERTISER_SITE_ID}/advertisers/{ADVERTISER_ID}/product_ads/campaigns/search` (ej.: `?filters[status]=active`) | ✅ | F1 |
| Campañas + métricas (rango) | El mismo `campaigns/search` con `date_from`, `date_to` (YYYY-MM-DD), `metrics=...`, `limit`, `offset` | ✅ | F1 |
| Métricas diarias | El mismo con `aggregation_type=DAILY`. En el ejemplo de la doc cada resultado trae `date` + métricas, **sin id de campaña** (parece un total de la cuenta por día). | 🟡 la forma de la respuesta hay que confirmarla en staging | F1 |
| Métricas sumarizadas | El mismo con `metrics_summary=true`. Agrega el objeto `metrics_summary` (total del rango) además de `results[]`. | ✅ | F1 |
| Detalle + métricas de una campaña | `GET /advertising/{ADVERTISER_SITE_ID}/product_ads/campaigns/{CAMPAIGN_ID}?date_from&date_to&metrics=...` (acepta `aggregation_type=DAILY`) | ✅ | F1 |
| Buscar ad groups por ítems | `GET /advertising/{SITE}/advertisers/{ADV}/product_ads/ad_groups/search?filters[item_ids]=MCO1,MCO2` (en **plural**; el filtro singular ya no se soporta). El `id` devuelto es el `ad_group_id` y `ad_group_external_id` es el ítem, `family_id` o `parent_id`. | ✅ | F1 |
| Detalle de un ad group | `GET /advertising/{SITE}/product_ads/ad_groups/{AD_GROUP_ID}?date_from&date_to&metrics=CLICKS,...` (`aggregation_type`: adgroup por defecto, o `daily`) | ✅ | F1 |
| Ad groups + métricas por anunciante | `GET /advertising/{SITE}/advertisers/{ADV}/product_ads/ad_groups/search?date_from&date_to&metrics=...&metrics_summary=true&filters[campaigns]=...&filters[statuses]=active&sort_by&sort` | ✅ | F1 |
| Métricas de los ad groups de una campaña | `GET /advertising/{SITE}/product_ads/campaigns/{CAMPAIGN_ID}/ad_groups/metrics?date_from=D&date_to=D&metrics=...`. **Si no se filtra, solo funciona con 1 día** (`date_from == date_to`); para rangos más largos hay que pasar `filters[ad_group_ids]`. Si no hay datos, `results` viene vacío. El ejemplo de la doc usa MCO. | ✅ | F1 |
| Anuncios (ítems) de un ad group, con métricas | `GET /advertising/{SITE}/product_ads/ad_groups/{AD_GROUP_ID}/ads?date_from&date_to&metrics=...`. Devuelve `item_id`, `campaign_id`, `price`, `title`, `status`, `permalink`, `logistic_type`, `listing_type_id`, `domain_id`, `family_id`, `user_product_id` y `metrics` (incluye `tacos`). | ✅ | F1 |

**Desactivados (dan 404 desde el 27/05/2026)**, NO usar: `GET /advertising/product_ads/items/{ITEM_ID}`, `GET /advertising/{SITE}/product_ads/items/{ITEM_ID}`, `GET /advertising/advertisers/{ADV}/product_ads/items`, `GET /advertising/{SITE}/advertisers/{ADV}/product_ads/items/search`, `GET /advertising/product_ads/campaigns/{ID}`, `GET /advertising/advertisers/{ADV}/product_ads/campaigns`, `.../campaigns/{ID}/metrics`, `product_ads_2/...`, `.../campaigns/{ID}/ads/metrics`, `GET /advertising/product_ads/ads/search`. Los endpoints de "Métricas de anuncios" (`.../product_ads/ads/search`, `.../campaigns/{ID}/ads/metrics`) **se eliminaron el 30/05/2026**: se reemplazan por las métricas de Ad Group (F1).

### Parámetros y límites de fechas (✅ F1)

- `date_from` y `date_to` en formato `YYYY-MM-DD`, obligatorios si se piden `metrics`.
- **Se puede consultar hasta 90 días hacia atrás.**
- Las métricas "se actualizan a las 10:00 hrs GMT-3" (08:00 en Bogotá).
- Un solo `aggregation_type` por llamada.
- `limit` por defecto 50; **`limit + offset` ≤ 10.000**.
- Filtros con la sintaxis `?filters[nombre]=valor`: `campaign_ids`, `campaign_id`, `status` (active, paused) y `channel` (marketplace por defecto).
- **Ventana de atribución: 14 días** después del clic. Por eso las ventas atribuidas a un día pueden seguir cambiando hasta 14 días después, y la sincronización tiene que volver a pedir al menos los últimos 15 días.
- `budget`: "promedio diario del presupuesto (mensual)… se actualiza a diario a las 4:00 hs GMT-3". Lo que no se gasta un día se usa en los siguientes hasta fin de mes (F1). Según F2, una campaña puede gastar en un día hasta 2× su presupuesto usando el saldo de días anteriores.
- ❌ **No documentado:** en qué zona horaria cortan los días de `date_from`/`date_to` (¿GMT-3?). Para el usuario en Bogotá (GMT-5), el "hoy" puede venir incompleto. Mostrar siempre "datos actualizados a <fecha/hora>".

### Nombres de métricas (✅ F1)

- **Campañas** (`campaigns/search`): `clicks, prints, ctr, cost, cost_usd, cpc, acos, organic_units_quantity, organic_units_amount, organic_items_quantity, direct_items_quantity, indirect_items_quantity, advertising_items_quantity, cvr, roas, sov, direct_units_quantity, indirect_units_quantity, units_quantity, direct_amount, indirect_amount, total_amount`.
- **Detalle de una campaña**: lo mismo más `impression_share, top_impression_share, lost_impression_share_by_budget, lost_impression_share_by_ad_rank, acos_benchmark`.
- **Ad groups y anuncios**: lo mismo de campañas **más `tacos`**. `tacos` aparece en las respuestas de ad group y de anuncios, **no** en la lista de métricas de campaña.
- **Campos de la campaña**: `id, name, status, strategy (PROFITABILITY | INCREASE | VISIBILITY), budget, daily_budget, currency_id, roas_target, acos_target, acos_top_search_target, automatic_budget, channel, advertiser_id, date_created, last_updated`.
- `roas_target`: está en las respuestas desde enero de 2026 y es el indicador estándar; tiene que estar **entre 1x y 35x**. `acos_target` = (1/ROAS)×100 y "seguirá visible hasta el 30/03/2026": **esa fecha ya pasó, así que no hay que contar con que venga**. Si falta, se calcula como `100 / roas_target` y se rotula como calculado.

Glosario oficial (F1), mapeado a los KPIs del tablero:

| KPI del tablero | Campo de la API | Comentario |
|---|---|---|
| Inversión | `cost` | "Suma del costo de los clics" |
| Ingresos | `total_amount` | = `direct_amount` + `indirect_amount`, en moneda local |
| Ventas atribuidas (cantidad) | `advertising_items_quantity` (y unidades en `units_quantity`) | Cada producto distinto del carrito cuenta como una venta |
| Otras ventas | `organic_items_quantity` / `organic_units_amount` | ⚠️ Según la doc, son "ventas **de tus publicaciones promocionadas** que no se generaron a partir de clics". **No es el total orgánico de la cuenta.** Rotularlo así en la UI. |
| ROAS | `roas` (o `total_amount / cost`) | |
| ACOS | `acos` (o `cost / total_amount × 100`) | |
| % ventas por anuncios | `sov` | "porcentaje de ventas por publicidad sobre ventas totales" |
| TACOS (por anuncio) | `tacos` | Solo en endpoints de ad group y anuncios |
| Impresiones / clics | `prints` / `clicks` | |
| Presupuesto diario | `budget` (y `daily_budget`) | |
| "Presupuesto compartido" | — | ❌ No hay un campo documentado para presupuesto compartido. Existe `automatic_budget` (boolean) **sin definición** en la doc, y el modo "Automático" de Product Ads es una sola campaña con un solo presupuesto. Solo mostrar "compartido" si se confirma en staging qué significa el campo. |

### Diagnóstico de campaña ("Aprendiendo N días", "Excelente"…)

❌ **No existe en la API.** Ningún campo de F1 o F2 devuelve un estado de aprendizaje. Lo tiene que calcular Zilonix con datos reales (por ejemplo, días desde `date_created` o desde el último cambio detectado en `last_updated`, `roas_target` o `budget`) y rotularlo como **diagnóstico calculado por Zilonix**, no como dato de Mercado Libre. Los umbrales son una decisión de producto que está pendiente.

---

## 3. Endpoints de Product Ads: escritura

| Para qué | Método y ruta | Estado | Fuente |
|---|---|---|---|
| Modificar campaña | `PUT https://api.mercadolibre.com/marketplace/advertising/{ADVERTISER_SITE_ID}/product_ads/campaigns/{CAMPAIGN_ID}` con cabeceras `api-version: 2` y `Content-Type: application/json`. Body con **al menos un** campo entre `name`, `budget`, `status` (active/paused), `roas_target` (1–35) y `strategy`. Devuelve la campaña actualizada (`budget`, `roas_target`, `acos_target` calculado, `last_updated`). | 🟡 Documentado **solo en Global Selling** (F2), con prefijo `/marketplace`. La doc CO (F1) **no tiene sección de escritura**. No verifiqué que la ruta funcione para un vendedor MCO local. | F2 |
| Crear campaña | `POST https://api.mercadolibre.com/marketplace/advertising/{SITE}/advertisers/{ADV}/product_ads/campaigns`. Hay que mandar todos los parámetros: `name, status, budget, strategy, channel, roas_target`. | 🟡 igual que arriba | F2 |
| Agregar, mover o quitar anuncios de una campaña | F2 los lista ("Add, move and update ads in campaign", su versión bulk, "Delete ad from campaign"), con rutas del tipo `.../product_ads/campaigns/{CAMPAIGN_ID}/ad_groups/...` | 🟡 F2; **fuera de alcance** de este módulo | F2 |
| Pujas manuales | No existen en Product Ads: la doc solo expone `strategy` + `roas_target` + `budget`. | ✅ (por ausencia en F1 y F2) | F1, F2 |

Datos útiles de F2:
- Cambiar el presupuesto a mitad de mes reinicia el cálculo.
- Pausar una campaña todo el mes hace que no se consuma presupuesto.
- Con `roas_target` bajo, más volumen; con `roas_target` alto, más rentabilidad y menos volumen.

---

## 4. Rate limits

| Hallazgo | Estado | Fuente |
|---|---|---|
| Se aplican sobre todo **por Client ID (la app)** y por endpoint; el tamaño del payload no cuenta. | ✅ | F7 |
| `429 Too Many Requests`: backoff exponencial con jitter, menos concurrencia, llamadas agrupadas. Se puede pedir más cuota mostrando el uso real. | ✅ | F7 |
| **Cifras concretas (RPM) para `/advertising`** | ❌ no publicadas | — |

El repo ya tiene `LimiteMercadoLibreError` en `lib/ml/cliente.ts` y `lib/trabajos/leerConReintento429.test.ts`: reutilizar ese patrón.

---

## 5. Comisiones por ítem (`listing_prices` / `sale_fee`) ✅ F8

- `GET https://api.mercadolibre.com/sites/{SITE}/listing_prices?price=&category_id=&currency_id=&listing_type_id=&logistic_type=&shipping_mode=&billable_weight=`. También acepta `catalog_product_id=` en lugar de `category_id`.
- Respuesta por tipo de publicación: `sale_fee_amount` y `sale_fee_details` (`percentage_fee`, `fixed_fee`, `gross_amount`, `financing_add_on_fee`, y `meli_percentage_fee` solo en MLA), además de `listing_fee_amount`.
- **Importante:** desde el **23/03 en Colombia** el `fixed_fee` depende del tipo de logística. Si no se mandan `logistic_type` y `shipping_mode`, "el fixed fee calculado no coincidirá con lo que realmente se cobrará". `billable_weight` solo es obligatorio en Argentina.
- Reglas para CO: si el precio está por debajo del umbral de envío gratis (TH) con ME2, solo Flex (`self_service`) cobra costo fijo. Con ME1, custom o not_specified siempre se cobra el costo fijo cuando el precio < TH. Con precio ≥ TH no hay costo fijo. El `sale_fee` siempre es un porcentaje que depende de la categoría.
- Valores de `logistic_type`: `drop_off, cross_docking, xd_drop_off, self_service, turbo, fulfillment, default (me1), custom, not_specified`.
- Insumos por ítem: `GET /items/{ITEM_ID}` (de ahí salen `category_id`, `listing_type_id`, `shipping.logistic_type`, `shipping.mode` y `shipping.free_shipping`). El repo ya tiene `obtenerItemMl` y `leerItemBasicoMl` en `lib/ml/cliente.ts`.

## 6. Precio de venta actual, con promoción ✅ F11

- `GET /items/{ITEM_ID}/sale_price?context=channel_marketplace` devuelve el precio de venta vigente en ese contexto, incluida la promoción activa.
- `GET /items/{ITEM_ID}/prices` lista los precios (estándar, promoción, por contexto).
- El campo `has_discount` del ad group se calcula con "regular amount vs amount" de la Prices API (F1).

## 7. Costo de envío para el vendedor ✅ F9, F10

- **Estimado por ítem:** `GET /users/{USER_ID}/shipping_options/free?item_id={ITEM_ID}&free_shipping=true` (también acepta `dimensions`, `item_price`, `listing_type_id`, `mode`, `logistic_type`, `condition`, `verbose`, `zip_code`). Devuelve `coverage.all_country.list_cost`, que es el "costo de envío ofrecido al vendedor", y opcionalmente `coverage.discount` (`rate`, `promoted_amount`).
  - La doc dice que es "una estimación aproximada… considerando únicamente la cantidad de un solo artículo". Por eso **se rotula como estimado**.
  - Hay que mandar `free_shipping` (true = el vendedor da envío gratis, false = paga el comprador) para que el costo salga bien. La doc recomienda consultar ambos casos.
  - Para usar `item_id`, el ítem tiene que existir y estar activo.
  - En MCO se usa `city`, no `zip_code` (F9).
- **Quién paga en la publicación:** `items/{id}.shipping.free_shipping` y el tag `mandatory_free_shipping` (solo ME2; si aparece, el envío gratis es obligatorio) (F9).
- **Costo real por envío ya hecho** (para conciliación, no para el tablero por producto): `GET /shipments/{id}/costs`. `senders[].cost` es lo que se le cobra al vendedor y `receiver.cost` lo que paga el comprador (F10).
- Cotización para el comprador: `GET /items/{ITEM_ID}/shipping_options?city_to=...` (`options[].cost`, `list_cost`). No hace falta para este módulo.

## 8. Discrepancias y cosas a verificar en staging antes de construir encima

1. **Prefijo y versión.** F1 (CO, vigente) documenta `GET /advertising/{SITE}/...` con `api-version: 2`. `zilonix-os/lib/ads-ml.js` (en producción) usa `/marketplace/advertising/{SITE}/...` con `Api-Version: 1`. F2 (Global Selling) usa `/marketplace/...` con `api-version: 2`. → Implementar las rutas de F1 para leer y **confirmar con una cuenta real (MTTIENDA, solo lectura)** antes de cerrar la Fase 1.
2. **Escritura para MCO local** (§3): solo está documentada en Global Selling. → Probarla **solo** en Fase 4, con aprobación explícita y sobre una campaña del piloto. Si no funciona, se pausa y se le pregunta a Mercado Libre: **nunca adivinar otra ruta**.
3. **Forma de `aggregation_type=DAILY`** en `campaigns/search` (¿total de la cuenta o por campaña?). Según el comentario de `zilonix-os/lib/ads-ml.js`, "Mercado Ads solo da un TOTAL para el rango pedido", así que allá se pide un día a la vez. Puede ser que nunca hayan probado `aggregation_type`. → Confirmarlo.
4. **`automatic_budget`**: no tiene definición en la doc. ¿Sirve para saber si el presupuesto es "compartido"? → Sin confirmar.
5. **`acos_target`** puede ya no venir (la doc lo daba hasta el 30/03/2026). → Calcularlo desde `roas_target`.
6. **Zona horaria del corte de días** de las métricas: no documentada.
7. **Aprobación de la app** para Advertising: no encontré ninguna; solo el permiso funcional.
8. **Duración del token**: 6 h en el texto contra `expires_in: 10800` en el ejemplo. → Usar `expires_in`.

## 9. Formato de números

- La API devuelve números JSON (por ejemplo `3992.0` o `25.58`). Los CSV y las hojas de cálculo colombianas usan coma decimal y punto de miles (`1.234.567,89`). Hace falta un normalizador único que acepte las dos formas y **rechace lo ambiguo** en lugar de adivinar. Ejemplo: `1.234` puede ser mil doscientos treinta y cuatro o uno coma dos tres cuatro; con contexto de moneda COP sin decimales se interpreta como miles, y en cualquier otro caso se pide confirmación.
- El dinero se guarda como `numeric(14,2)` y se suma en centavos con `BigInt`, el mismo criterio que `lib/finanzas/utilidad-venta.ts`.
- Links de publicación: `https://articulo.mercadolibre.com.co/MCO-{dígitos}` (con guion) o el `permalink` que devuelve la API (F1 lo trae en los anuncios). Ya existe `linkPublicacion(itemId)` en `lib/ml/cliente.ts`; verificar que arme ese formato.

---

## 10. Notas de esta implementación (fase 1, issue #254)

Esto no es un hallazgo nuevo de la doc: es lo que el código de esta fase hace con lo de arriba, y lo que **sigue sin confirmarse contra una cuenta real**.

- El cliente lee **solo** las rutas de F1 (`/advertising/...`), nunca `/marketplace/advertising/...` (la de Zilonix OS y la de escritura en F2). El permiso "Publicidad de un producto" quedó confirmado en la app Zilonix Plataforma (lectura y escritura) y MTTIENDA se reconectó en Seller. Sigue sin hacerse una llamada real desde este código: en staging hay que contrastar totales contra la Central, la forma de `aggregation_type=DAILY` y que `/advertising/...` con `api-version: 2` responda.
- Cabeceras, tal cual F1: `GET /advertising/advertisers` manda `Api-Version: 1`. El resto de Product Ads de esta fase manda `api-version: 2`.
- Un token emitido **antes** de activar el permiso puede no traerlo. Un `403` con `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` queda como `sin_permiso_app` y el aviso para la persona es reconectar la cuenta desde Seller. Un `404` con "No permissions found for user_id" en advertisers queda como `sin_product_ads` (la cuenta no tiene Product Ads). No son el mismo caso.
- `aggregation_type=DAILY` en `campaigns/search`: el ejemplo de F1 trae `date` + métricas **sin id de campaña**, y el ejemplo muestra dos filas con la misma fecha. Hasta confirmarlo en staging, si hay más de una fila para la misma fecha sin id, **no se guarda** el total de cuenta (no se fusionan). El detalle por campaña (`/product_ads/campaigns/{id}?aggregation_type=DAILY`) sí se guarda contra el id pedido, porque esa ruta es de una campaña.
- Esta fase no llama ningún PUT ni POST de campañas. La app tiene el permiso de escritura; igual no se usa hasta la fase 4. `lib/ml/publicidad.test.ts` falla si el cliente deja de ser solo GET.
- Staging y producción usan la misma app de Mercado Libre. Una cuenta real se conecta en un solo entorno a la vez: el refresh token es de un solo uso y conectarla en el otro invalida el de acá. El detalle está en `docs/publicidad/entornos.md`.
- La zona horaria del corte de `date_from`/`date_to` sigue sin estar documentada (§8.6). El rango se arma en calendario de Bogotá y la `fecha` que se guarda es el `date` que devuelve la API, sin correrlo de zona.
