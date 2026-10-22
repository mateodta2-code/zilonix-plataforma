# Estado real de Zilonix Seller

Foto del proyecto al **2026-10-22**. Esto cambia después de cada tarea — la fuente de verdad detallada, tarea por tarea, es `docs/CHANGELOG.md`; el plan completo (todas las fases, criterios de "listo") vive en `zilonix-os-web/docs/plan-tecnico.md`. Esta página es el resumen para que alguien nuevo entienda dónde estamos sin leer los dos documentos enteros.

## Qué está terminado y funcionando

**Fase 1 (Multiempresa y seguridad) — 12/12 tareas cerradas.** Repositorio base, modelo de datos, seguridad por fila (RLS) con tres usuarios de base distintos, login con Clerk, empresas y cambio de empresa en 1 clic, invitaciones por correo, permisos por rol/módulo/acción con pantalla de confirmación para los peligrosos, registro de auditoría, cabeceras de seguridad + límite de peticiones, panel superadmin con acceso temporal auditado. Confirmado de punta a punta con una cuenta y una empresa reales en staging.

**Fase 2 (Mercado Libre), cerradas y en `main`:**
- **2.1** App de Zilonix en Mercado Libre Developers (credenciales en Railway, staging y producción).
- **2.2** Contrato único de conector (`lib/conectores/`), probado con un conector falso en memoria.
- **2.3** Conectar una cuenta de Mercado Libre en 1 clic — OAuth con PKCE, tokens cifrados con versión de clave, candado contra renovaciones dobles del refresh token.
- **2.4** Avisos de Mercado Libre (webhooks) y el trabajador que los procesa de verdad contra la API (nunca confía en el contenido del aviso).
- **2.5** Importación inicial (pedidos de 60 días + publicaciones activas) al conectar una cuenta.
- **2.6** SKU maestro propio, con kits.
- **2.7** Pedidos con línea de tiempo de 8 pasos (venta → pago → factura → empaque → despacho → entrega → novedades → dinero conciliado).
- **2.10** Despachos (Full/Flex/Colecta, impresión masiva de etiquetas) — código en `main`, pero su migración y la base de seguridad (RLS) **todavía no se aplicaron contra staging ni producción** (ver "Problemas conocidos").
- **Z-MT-08** Selector compartido de cuenta de Mercado Libre (`components/SelectorCuentaMl.tsx`, `lib/ml/selector-cuenta.ts`): elige "Todas" o una cuenta y lo deja en `?cuenta=`. La lectura pasa por `dbComoEmpresa` y al cliente solo salen `id` y apodo. Un `?cuenta=` de otra empresa se trata como "Todas". Bandeja, publicar, inventario y despachos todavía no lo montan — cada pantalla lo adopta en su propio issue.

## Qué está a medias

- **2.9 — Bandeja de atención** (preguntas, mensajes de venta, reclamos): código completo, con sus pruebas, en un Pull Request abierto (`tarea-2.9-bandeja-atencion`) que **todavía no se fusionó a `main`**.
- **2.11, sub-tarea "Publicar producto y clip"**: las reglas reales de publicación en Mercado Libre portadas por completo (con pruebas), en un Pull Request abierto (`tarea-2.11-publicar-producto-clip`) — tampoco fusionado. Las otras tres sub-tareas de 2.11 (Promociones, Programar Full, Alertas sanitarias) **no se empezaron**.
- Ninguna de las tres cosas de arriba se probó todavía contra una base de datos real de staging/producción ni, en el caso de "Publicar producto", contra una cuenta real de Mercado Libre — ver el bloqueo de Railway abajo.

## Qué falta

- **2.8 — Inventario por bodega**: pausada a propósito. El concepto de "bodega en tránsito" (traslados entre bodegas) que pide la tarea no existe en el Zilonix OS actual — se decidió no inventarlo y esperar a que Mateo lo hable con Franky antes de construir nada.
- **2.11b/c/d** (Promociones, Programar Full, Alertas sanitarias): sin empezar.
- **Fases 3 (Finanzas/DIAN), 4 (Piloto pagado) y 5 (Escalar)**: sin empezar.
- **Aviso automático a FullyLemon cuando cambia el estado de una guía de Mercado Libre**: se le pidió a FullyLemon el detalle real de su endpoint — esperando su respuesta antes de construir nada (no se adivinó el contrato).

## Decisiones que tomamos y por qué

La tabla completa de decisiones (D1–D8, N1–N8) vive en `zilonix-os-web/docs/plan-tecnico.md` — acá solo las que más afectan cómo está armado este repo:

- **Una empresa por NIT/sociedad; un mismo usuario puede estar en varias empresas** y cambiar entre ellas sin cerrar sesión. Por esto `usuarios` no tiene seguridad por fila (RLS) — no pertenece a una sola empresa — pero todo lo demás sí.
- **Clerk como proveedor de login**, en vez de construir registro/sesión/2FA a mano — el riesgo de un bug propio en autenticación no vale la pena cuando ya existe un proveedor probado.
- **Railway como hosting**, mismo proveedor que el Zilonix OS actual, con `staging` y `producción` como ambientes separados (cada uno su propio Postgres).
- **El acceso de superadmin a datos de una empresa es temporal y explícito**: la propia empresa lo concede por un plazo máximo (hoy 15 días) desde su panel, nunca es un interruptor permanente, y cada vista queda en auditoría.
- **Dominio**: la plataforma nueva se queda con `app.zilonix.com`; el Zilonix OS actual se muda a `os.zilonix.com` — decisión ya tomada, **pendiente de ejecutar** (no es un bloqueo técnico, es un paso manual en el proveedor de dominio).

## Problemas conocidos

### 1. `/panel` responde 500 en staging (confirmado ahora mismo, 2026-10-21)

Al revisar esto directamente: `GET /sign-in` y `GET /api/version` responden bien (200) en `https://web-staging-d979.up.railway.app`, pero `GET /panel` responde **500 Internal Server Error** de forma reproducible. (Nota: la ruta real de login en este proyecto es `/sign-in`, no `/login` — Clerk la nombra así; no encontramos una ruta `/login` en el código.)

No se pudo confirmar la causa exacta todavía — los logs de Railway para el servicio de staging solo devolvieron ruido de errores de red (`socket hang up`) al intentar leerlos, probablemente por la misma caída de Railway que está activa hoy (ver más abajo), no por un problema propio de la app. La hipótesis más probable: `/panel` es la primera ruta que de verdad consulta Postgres (lista las empresas del usuario); `/sign-in` y `/api/version` no tocan la base — así que si la conexión del servicio de staging a su propio Postgres está intermitente por la caída de Railway, encajaría con este patrón exacto. **Queda pendiente confirmarlo con un log real** apenas Railway se recupere.

### 2. Caída grande de Railway, activa desde el 2026-10-21 (07:24 UTC)

Dashboard, build y parte de la API de Railway con fallas (confirmado en `status.railway.com`). El túnel privado a Postgres (`railway connect ... --tunnel-only`) agota el tiempo de espera de forma consistente. GitHub Actions (CI) no depende de Railway — el código sigue avanzando y probándose ahí — pero todo lo que necesita tocar la base real de staging/producción (aplicar migraciones, correr `db/rls-setup.sql`, fusionar las tareas 2.9/2.10/2.11a) está frenado hasta que se recupere.

### 3. Colisión de numeración de migraciones

Las ramas de las tareas 2.9 y 2.11a nacieron de versiones distintas de `main` y cada una generó su propia migración con el mismo número (`0008`/`0009`, según el caso). Hay que renumerar la que se fusione después, en el momento de fusionarla — no es un bug, es trabajo pendiente de coordinación.

## Variables de entorno necesarias

Solo los nombres — ningún valor real vive ni debe vivir en este repositorio. Se configuran en Railway (staging y producción tienen cada una sus propios valores) o en `.env.local` para desarrollo local (ver `.env.example`).

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Superusuario de Postgres que da Railway — **solo** para correr migraciones (`npm run db:migrate`) |
| `DATABASE_URL_APP` | Usuario `app_user` (respeta RLS) — el que usa la app en tiempo real |
| `DATABASE_URL_SUPERADMIN` | Usuario `superadmin_user` — solo lectura agregada, panel `/superadmin` |
| `DATABASE_URL_TRABAJADOR` | Usuario `trabajador_user` — solo puede tocar `avisos_ml` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk, lado del navegador |
| `CLERK_SECRET_KEY` | Clerk, lado del servidor |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | App de Mercado Libre (OAuth) |
| `ML_TOKEN_KEY_V1` / `ML_TOKEN_KEY_V2` | Claves de cifrado de los tokens de Mercado Libre (versión de clave, para poder rotarla) — V2 todavía no existe, se usa cuando toque rotar |
| `TRABAJADOR_SECRET` | Secreto compartido que valida al cron que llama a `/api/ml/trabajador` |
| `LIMITE_PETICIONES_POR_IP` / `LIMITE_PETICIONES_POR_USUARIO` | Opcionales — suben el límite de peticiones del middleware (pensado para pruebas manuales en staging, nunca para producción) |
| `RAILWAY_PUBLIC_DOMAIN` | La pone Railway sola — dominio público real, para armar links (ej. invitaciones) sin depender del header `host` |

## Próximos pasos pensados (en orden)

1. Confirmar que el túnel privado a Postgres de staging ya responde; aplicar la migración y `db/rls-setup.sql` de las tareas 2.9 y 2.10 contra staging y producción, correr sus pruebas contra una base real, y fusionar ambos Pull Requests (resolviendo antes la colisión de numeración de migraciones).
2. Diagnosticar con un log real el 500 de `/panel` en staging y confirmar si era solo la caída de Railway o algo más.
3. Hacer lo mismo con la tarea 2.11a ("Publicar producto y clip") y probarla contra una cuenta real de Mercado Libre — es la única parte del flujo (el endpoint de subir un Clip/video) que nunca se confirmó en vivo.
4. Construir las sub-tareas 2.11b, 2.11c y 2.11d (Promociones, Programar Full, Alertas sanitarias), una por una, cada una en su propio Pull Request.
5. Retomar la tarea 2.8 (inventario por bodega) cuando Mateo y Franky definan qué es una "bodega en tránsito" en este sistema.
6. Retomar la integración con FullyLemon (aviso de cambio de estado de guía) cuando respondan con el contrato real de su endpoint.
7. Ejecutar la mudanza de dominio ya decidida (`app.zilonix.com` / `os.zilonix.com`).
