# Modelo de datos base — tarea 1.2

Diagrama en palabras simples, para aprobar antes de construir (como pide el plan técnico). Siete tablas, el esqueleto de "quién puede hacer qué, en qué empresa".

## 1. `empresas`

Cada negocio que se registra en la plataforma.

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| nombre | nombre del negocio |
| nit | NIT — una empresa por NIT/sociedad (decisión D2) |
| creado_ts | cuándo se registró |

## 2. `usuarios`

Las personas que entran a Zilonix — no pertenecen a una sola empresa, pueden estar en varias (decisión D2: "un login, varias empresas, cambio en 1 clic").

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| email | correo (único en toda la plataforma) |
| nombre | nombre de la persona |
| clerk_user_id | el identificador que le da Clerk (decisión D3) — Clerk maneja el login en sí, acá solo se guarda el vínculo |
| creado_ts | cuándo se creó |

## 3. `roles`

"Dueño", "Operador", "Contador", "Proveedor", "Domiciliario", etc. Algunos son plantillas de fábrica (iguales para cualquier empresa), y cada empresa puede armar los suyos propios a partir de esas plantillas (evidencia real de Effi: un rol "Vendedora" pudo crear usuarios y cambiar la numeración DIAN sin aviso — acá cada rol nace de una plantilla segura, no de cero).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| nombre | ej. "Operador" |
| empresa_id | vacío = plantilla de fábrica, compartida; con valor = rol propio de esa empresa |
| es_plantilla | si es una de las plantillas base del sistema |

## 4. `membresias`

La conexión real: "esta persona está en esta empresa, con este rol."

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| usuario_id | quién |
| empresa_id | en qué empresa |
| rol_id | con qué rol |
| creado_ts | desde cuándo |

Una persona solo puede tener **un** rol por empresa (no varios roles mezclados en la misma empresa).

## 5. `permisos_rol`

Por cada rol, qué puede hacer en cada módulo (Ventas, Inventario, Facturación, Tesorería, Personas, Configuración...).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| rol_id | de qué rol |
| modulo | ej. "ventas", "inventario" |
| accion | Consultar / Crear / Modificar / Anular / Autorizar |
| alcance | "todo" o "solo lo propio" (lo que esa persona creó) — confirmado agregar desde ya, evidencia real vista en Effi |

## 6. `invitaciones`

Cuando un dueño invita a alguien por correo.

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| empresa_id | a qué empresa |
| email | a quién se invita |
| rol_id | con qué rol entra |
| token | link de un solo uso |
| invitado_por | qué usuario mandó la invitación |
| expira_ts | hasta cuándo vale |
| aceptada_ts | vacío hasta que se acepte |

## 7. `auditoria`

Quién hizo qué, cuándo, en qué empresa — separando siempre una persona real de una acción automática del sistema (evidencia real de Effi: le atribuían a una persona ventas que en realidad sincronizó la integración sola).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| empresa_id | en qué empresa (vacío para acciones de plataforma, ej. login) |
| usuario_id | quién, si fue una persona (vacío si fue el sistema) |
| actor_tipo | "persona" o "sistema" |
| accion | qué pasó, en palabras simples |
| entidad | sobre qué (ej. "Ventas", "Facturación") |
| detalle | información extra |
| ts | cuándo |

## Cómo se conectan

```
empresas ──┬── membresias ──── usuarios
           │        │
           │        └── roles ──── permisos_rol
           │
           ├── invitaciones
           └── auditoria
```

## 8. Publicidad (Product Ads, issue #254)

Seis tablas, todas con `empresa_id` y `cuenta_ml_id`. El dinero es `numeric`, nunca float. La `fecha` de una métrica es el `date` que devuelve Mercado Libre, sin corrimiento de zona (la API no documenta el corte del día).

| Tabla | Qué guarda | Única por |
|---|---|---|
| `publicidad_anunciantes` | Si la cuenta tiene Product Ads, no lo tiene, o la app no tiene el permiso | empresa + cuenta |
| `publicidad_campanas` | Campaña: estado, presupuesto, ROAS/ACOS objetivo | empresa + cuenta + id de campaña |
| `publicidad_anuncios` | Anuncio dentro de un ad group | empresa + cuenta + ad group + ítem |
| `publicidad_metricas_diarias` | Métricas del día, a nivel cuenta, campaña, ad group o anuncio | empresa + cuenta + nivel + entidad + ad group + fecha |
| `publicidad_costos_item` | Precio, comisión y envío estimado vigentes del ítem (no es una serie histórica) | empresa + cuenta + ítem + fecha |
| `publicidad_sincronizaciones` | Bitácora de cada corrida: origen, rango, estado, texto corto de error | una sola fila `en_curso` por empresa + cuenta |

Transferir una cuenta de Mercado Libre cambia el `empresa_id` de `cuentas_ml` y deja el mismo `id`. Las filas de publicidad no se mueven con ella: se quedan con el `empresa_id` de la empresa que las sincronizó. RLS las muestra solo a esa empresa. La empresa nueva no las ve y empieza de cero; un upsert no pisa el historial anterior porque `empresa_id` entra en la clave única. No quedan datos visibles de una empresa en la otra.

En métricas de anuncio, `ad_group_id` vacío no aplica (cuenta, campaña, ad group). En anuncio es el grupo: el mismo ítem puede estar en dos grupos y son dos filas.

`cierra_backfill` es true solo cuando un tramo `ok` termina el historial con acceso real a Product Ads. Un `ok` de `sin_product_ads` o `sin_permiso_app` no lo prende.

`automatic_budget` se guarda tal cual llega. La doc no dice que signifique presupuesto compartido. `acos_target` puede no venir y se calcula como 100/ROAS, marcado como calculado. El estado "Aprendiendo" no está en la API.

## 9. `cuentas_ml` — país, moneda e idioma (Z-LATAM-01, issue #315)

Tres columnas nuevas en `cuentas_ml` (migración 0020), pensadas para que Seller funcione en otros países de LATAM, no solo Colombia — Finanzas, Publicidad y WMS venían asumiendo Colombia/COP en todo lo nuevo.

| Columna | Qué es | Default (filas viejas) |
|---|---|---|
| `site_id` | Sitio real de Mercado Libre de esta cuenta — texto acotado con un `CHECK` a los 5 países que opera Zilonix: `MCO`, `MLM`, `MLB`, `MLA`, `MLC` | `MCO` |
| `moneda` | Código ISO 4217, derivado de `site_id` (nunca se le vuelve a preguntar a Mercado Libre por separado) | `COP` |
| `idioma` | Locale BCP 47 (ej. `es-CO`, `pt-BR`), derivado de `site_id` | `es-CO` |

El mapa site_id → moneda/idioma vive en `lib/ml/sitios.ts` (`SITIOS_ML`, `datosSitioMl`) — una sola fuente de verdad, con test propio (`lib/ml/sitios.test.ts`). Se llena al conectar o reconectar una cuenta (`app/api/ml/callback/route.ts` → `lib/ml/oauth.ts`, `obtenerDatosVendedorMl`, que lee `site_id` de la misma respuesta de `GET /users/me` que ya traía el nickname — ninguna llamada nueva a Mercado Libre) y vuelve a actualizarse en cada reconexión o transferencia de cuenta, nunca se queda con un valor viejo si Mercado Libre manda uno distinto.

`CHECK cuentas_ml_site_id_valido` rechaza cualquier `site_id` que no sea uno de los 5 — texto en vez de un enum real de Postgres a propósito: agregar un país nuevo más adelante es un `ALTER TABLE` simple (migración nueva, nunca a mano), nunca el `ALTER TYPE` fuera de transacción que exige un enum.

Un país nuevo (ej. Perú, Uruguay) necesita: una fila más en `SITIOS_ML`, el mismo valor agregado al `CHECK` (migración nueva) y, recién después, revisar los lugares con `MCO`/`COP`/`es-CO` fijos que quedaron pendientes de la auditoría de este issue (ver el PR de la migración 0020 para la lista completa) — la mayoría son pantallas de Finanzas/Publicidad/Investigación que formatean moneda o números con el locale `es-CO` fijo, y el flujo de Publicar (`lib/ml/cliente.ts`, `SITE_ID`), que busca en el catálogo global de Mercado Libre siempre contra el sitio de Colombia.

## Lo que falta para que esto funcione seguro (próximas tareas, no esta)

- ~~**Seguridad por fila (RLS)** en Postgres~~ — tarea 1.3, completa: `db/rls-setup.sql` ya corrido contra la base real de Railway (ver `docs/rls.md`).
- ~~**Prueba automática de aislamiento**~~ — tarea 1.4, completa: `db/rls.test.ts`, corre en cada PR contra un Postgres real de prueba.
- **Login de verdad con Clerk** (hoy `clerk_user_id` es solo un campo vacío, esperando la integración) — tarea 1.5.
- **Decisión D8 (14/10/2026)**: el acceso del superadmin a cifras agregadas de negocio (no al detalle del comprador) de cualquier empresa es un mecanismo APARTE del de esta tabla — usa su propio rol de base de datos con sus propias políticas, más permisivo solo sobre las tablas agregadas. Se construye en la tarea 1.11, no acá.
