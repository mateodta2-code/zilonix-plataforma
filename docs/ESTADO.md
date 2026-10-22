# Estado real de Zilonix Seller

Foto del proyecto al **2026-10-22**. Esto cambia después de cada tarea — la fuente de verdad detallada, tarea por tarea, es `docs/CHANGELOG.md`; el plan completo (todas las fases, criterios de "listo") vive en `zilonix-os-web/docs/plan-tecnico.md`. Esta página es el resumen para que alguien nuevo entienda dónde estamos sin leer los dos documentos enteros.

**Dependencias (2026-10-22).** `@clerk/nextjs` está en **6.39.8** (CVE-2026-41248, bypass de `createRouteMatcher`; antes 6.9.6) y el repo versiona `package-lock.json`. El CI instala con `npm ci`. Railway con Railpack no pasa a `npm ci` solo por existir el lock: hace falta `RAILPACK_NODE_NPM_INSTALL=npm ci` en el servicio (no se cambió la configuración de Railway en este cambio). `/_next/image` queda apagado con `images.unoptimized` — la app no usa `next/image`. El upgrade de Clerk en sí no tocó `middleware.ts` — eso es justo este PR (`fix-middleware-rutas-maquina`, #27), ya fusionado con esta actualización: las rutas de máquina (`/api/ml/webhooks`, `/api/ml/trabajador`, `/api/ml/callback`) ya están en la lista pública (`lib/rutas-publicas.ts`) y el middleware ya no usa `auth.protect()` — ver "Problemas conocidos §1" abajo.

## Qué está terminado y funcionando

**Fase 1 (Multiempresa y seguridad) — 12/12 tareas cerradas.** Repositorio base, modelo de datos, seguridad por fila (RLS) con tres usuarios de base distintos, login con Clerk, empresas y cambio de empresa en 1 clic, invitaciones por correo, permisos por rol/módulo/acción con pantalla de confirmación para los peligrosos, registro de auditoría, cabeceras de seguridad + límite de peticiones, panel superadmin con acceso temporal auditado. Confirmado de punta a punta con una cuenta y una empresa reales en staging. **Matices reales, no resueltos todavía**: el 2FA obligatorio para los roles Dueño/Contador sigue sin construirse (hoy 2FA existe pero es opcional para cualquiera); la instancia de Clerk sigue en modo **Development** (`composed-hamster-7072.clerk.accounts.dev`), no Production — pasar a Production implica confirmar si se paga el plan Pro de Clerk (ver "Qué falta").

**Fase 2 (Mercado Libre), cerradas y en `main`:**
- **2.1** App de Zilonix en Mercado Libre Developers (credenciales en Railway, staging y producción).
- **2.2** Contrato único de conector (`lib/conectores/`), probado con un conector falso en memoria.
- **2.3** Conectar una cuenta de Mercado Libre en 1 clic — OAuth con PKCE y, desde este PR, `state` (RFC 6749 §10.12, protección CSRF), tokens cifrados con versión de clave, candado contra renovaciones dobles del refresh token.
- **2.5** Importación inicial (pedidos de 60 días + publicaciones activas) al conectar una cuenta.
- **2.6** SKU maestro propio, con kits.
- **2.7** Pedidos con línea de tiempo de 8 pasos (venta → pago → factura → empaque → despacho → entrega → novedades → dinero conciliado). **Alcance real, no un bug**: la tabla `pedidos` hoy solo guarda `total` — ni comisión de Mercado Libre (`sale_fee`), ni costo de envío, ni neto. Eso es lo primero que necesita la Fase 3 (ver "Qué falta").
- **2.10** Despachos (Full/Flex/Colecta, impresión masiva de etiquetas) — código en `main`, pero su migración y la base de seguridad (RLS) **todavía no se aplicaron contra staging ni producción** (bloqueado por la caída de Railway, ver "Problemas conocidos §2" — nunca por el bug del middleware).

## Qué está a medias

- **2.4** Avisos de Mercado Libre (webhooks) y el trabajador que los procesa de verdad contra la API. El código está en `main`, pero hasta este PR (`fix-middleware-rutas-maquina`) estuvo roto en ejecución — ver "Problemas conocidos §1". Se mueve de "terminado" a esta sección a propósito: el fix ya está escrito y probado localmente, pero **todavía no se verificó contra staging real** (ni con el workflow `trabajador-avisos-ml.yml` en verde) — no se da por cerrada hasta tener esa evidencia.
- **2.9 — Bandeja de atención** (preguntas, mensajes de venta, reclamos): código completo, con sus pruebas, en la rama [`tarea-2.9-bandeja-atencion`](https://github.com/mateodta2-code/zilonix-plataforma/tree/tarea-2.9-bandeja-atencion) — **sin ningún Pull Request abierto todavía** (no es que esté esperando revisión; nadie lo abrió aún).
- **2.11, sub-tarea "Publicar producto y clip"**: las reglas reales de publicación en Mercado Libre portadas por completo (con pruebas), en la rama [`tarea-2.11-publicar-producto-clip`](https://github.com/mateodta2-code/zilonix-plataforma/tree/tarea-2.11-publicar-producto-clip) — tampoco tiene Pull Request abierto. Promociones y Programar Full **no se empezaron**. Alertas sanitarias (Z-NV-03a, issue #61): las funciones puras están en un Pull Request en borrador (`lib/sanitarias/`); faltan los 5 casos reales de Frankie y toda la parte de tablas, red y pantalla (Z-NV-03b).
- Ninguna de las dos ramas de arriba se probó todavía contra una base de datos real de staging/producción ni, en el caso de "Publicar producto", contra una cuenta real de Mercado Libre — bloqueado por la caída de Railway (ver "Problemas conocidos §2"), sin relación con el bug del middleware.

## Qué falta

- **2.8 — Inventario por bodega**: pausada a propósito. El concepto de "bodega en tránsito" (traslados entre bodegas) que pide la tarea no existe en el Zilonix OS actual — se decidió no inventarlo y esperar a que Mateo lo hable con Franky antes de construir nada.
- **2.11b/c** (Promociones, Programar Full): sin empezar. **2.11d / Z-NV-03a** (Alertas sanitarias): en borrador, solo las funciones puras; la parte con tablas y pantalla es Z-NV-03b y no se empezó.
- **Panel de urgencias (tarea 2.13)**: sin empezar — hoy `/panel` es solo una lista de enlaces a módulos, no tiene ninguna vista de "lo que necesita atención ya".
- **Comisión, envío y neto por pedido**: `pedidos` solo guarda `total` (ver nota en 2.7, arriba) — es de lo primero que pide un piloto real de Fase 3.
- **DIAN / facturación (Fase 3)**: sin empezar, y sin proveedor elegido todavía — rondas de investigación citadas en el plan técnico comparan Factus, Alanube y Plemsi, pero no hay decisión. `/panel/finanzas` que existe hoy es solo una pantalla de demostración de permisos (tarea 1.7), no factura nada real.
- **2FA obligatorio (Dueño/Contador) y Clerk en modo Production**: ver matiz en "Qué está terminado" — ambos pendientes, con un costo real de Clerk por confirmar antes de pasar a Production.
- **Fases 4 (Piloto pagado) y 5 (Escalar)**: sin empezar.
- **Aviso automático a FullyLemon cuando cambia el estado de una guía de Mercado Libre**: se le pidió a FullyLemon el detalle real de su endpoint — esperando su respuesta antes de construir nada (no se adivinó el contrato).

## Decisiones que tomamos y por qué

La tabla completa de decisiones (D1–D8, N1–N8) vive en `zilonix-os-web/docs/plan-tecnico.md` — acá solo las que más afectan cómo está armado este repo:

- **Una empresa por NIT/sociedad; un mismo usuario puede estar en varias empresas** y cambiar entre ellas sin cerrar sesión. Por esto `usuarios` no tiene seguridad por fila (RLS) — no pertenece a una sola empresa — pero todo lo demás sí.
- **Clerk como proveedor de login**, en vez de construir registro/sesión/2FA a mano — el riesgo de un bug propio en autenticación no vale la pena cuando ya existe un proveedor probado.
- **Railway como hosting**, mismo proveedor que el Zilonix OS actual, con `staging` y `producción` como ambientes separados (cada uno su propio Postgres).
- **El acceso de superadmin a datos de una empresa es temporal y explícito**: la propia empresa lo concede por un plazo máximo (hoy 15 días) desde su panel, nunca es un interruptor permanente, y cada vista queda en auditoría.
- **Dominio**: la plataforma nueva se queda con `app.zilonix.com`; el Zilonix OS actual se muda a `os.zilonix.com` — decisión ya tomada, **pendiente de ejecutar** (no es un bloqueo técnico, es un paso manual en el proveedor de dominio).
- **Una ruta que llama una máquina (webhook, cron, callback OAuth) se declara pública en el middleware y se autentica con su propio mecanismo** — nunca con la sesión de Clerk. Decisión tomada en este PR (`fix-middleware-rutas-maquina`) después de que la falta de esta regla causara un 500 real en producción potencial (ver "Problemas conocidos §1"); queda explícita en `CLAUDE.md`.

## Problemas conocidos

### 1. Middleware: toda ruta de máquina sin sesión se colgaba 30s y daba 500 — **corregido en este PR, pendiente de verificar en staging**

Diagnóstico confirmado con `curl` contra staging (2026-10-21): toda ruta NO pública pedida sin sesión y sin cabecera `Accept: text/html` respondía **500** a los ~30,1 segundos, con `x-clerk-auth-reason: protect-rewrite` y `x-middleware-rewrite: https://web-staging-d979.up.railway.app/clerk_<timestamp>`. Afectaba a `/panel`, `/cuenta`, `/login` (que no existe como página — la real es `/sign-in`), `/api/ml/webhooks`, `/api/ml/trabajador` y `/api/ml/callback`. `/`, `/sign-in`, `/sign-up` y `/api/version` respondían 200 en ~0,15s; con cabeceras de navegador, `/panel` respondía 307 hacia el handshake de Clerk en 0,13s — el bug solo se veía para peticiones SIN esas cabeceras, el perfil exacto de un webhook, un cron o un `curl`.

**Causa real**: con `@clerk/nextjs` 6.9.6, `auth.protect()` intenta un rewrite a una URL absoluta de Clerk (el handshake) cuando no hay sesión en una petición que no es de documento. Detrás del proxy de Railway, Next trata ese rewrite como externo y se cuelga hasta el timeout — mismo síntoma reportado en Clerk: https://github.com/clerk/javascript/issues/3864 (persiste incluso en versiones más nuevas, no es algo que se arregle solo subiendo la versión). No era la base de datos ni la caída de Railway (ver §2) — eso fue un diagnóstico anterior equivocado, corregido acá con evidencia real.

**Impacto real que esto causaba**: el webhook de Mercado Libre nunca recibía su 200 rápido (riesgo real de que Mercado Libre desactive el callback); el workflow `trabajador-avisos-ml.yml` fallaba siempre (3 de 3 corridas revisadas); la tarea 2.4 nunca procesó un aviso real por esta vía en staging.

**Corrección**: `middleware.ts` ya no llama `auth.protect()` para decidir esto — ver `lib/rutas-publicas.ts` (rutas de máquina declaradas públicas, autenticadas con su propio mecanismo) y el chequeo explícito en `middleware.ts` (401 inmediato en `/api/*`, redirect directo a `/sign-in` en páginas). **Esto se marca como corregido solo después de desplegar a staging y confirmar con los mismos curls que lo diagnosticaron** (ver criterios de aceptación del PR) — no antes.

### 2. Caída grande de Railway, activa desde el 2026-10-21 (07:24 UTC)

Dashboard, build y parte de la API de Railway con fallas (confirmado en `status.railway.com`). El túnel privado a Postgres (`railway connect ... --tunnel-only`) agota el tiempo de espera de forma consistente. GitHub Actions (CI) no depende de Railway — el código sigue avanzando y probándose ahí — pero todo lo que necesita tocar la base real de staging/producción (aplicar migraciones, correr `db/rls-setup.sql`, fusionar las ramas 2.9/2.10/2.11a a producción) está frenado hasta que se recupere. **Esto es un bloqueo real pero aparte** del problema §1 — no lo explica ni lo reemplaza.

### 3. Colisión de numeración de migraciones (2.9 contra `main`, no contra 2.11)

`main` ya tiene `0008_married_thunderbird.sql` (de la tarea 2.10, ya fusionada). La rama de la tarea 2.9 nació de un `main` anterior y trae su propia `0008_useful_skreet.sql` — choca con la de `main`, no con la de 2.11. La rama de 2.11 nació de un `main` ya al día y trae `0009_classy_morph.sql`, sin ningún choque hoy.

**Orden propuesto para cuando se puedan fusionar** (fuera de alcance de este PR): primero la rama de 2.11 (con su `0009` tal cual); después rebasar la rama de 2.9 sobre el nuevo `main` y regenerar su migración como `0010`. Antes de fusionar cualquiera de las dos, comprobar el contenido real de `drizzle.__drizzle_migrations` en staging (y en producción) — si la `0008` de la rama de 2.9 llegó a aplicarse alguna vez contra alguna base, el journal de Drizzle queda inconsistente y hay que resolverlo a mano antes de seguir, no asumir que nunca se corrió.

## Variables de entorno necesarias

Solo los nombres — ningún valor real vive ni debe vivir en este repositorio. Se configuran en Railway (staging y producción tienen cada una sus propios valores) o en `.env.local` para desarrollo local (ver `.env.example`, que ya tiene los nombres de abajo sincronizados).

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Superusuario de Postgres que da Railway — **solo** para correr migraciones (`npm run db:migrate`) |
| `DATABASE_URL_APP` | Usuario `app_user` (respeta RLS) — el que usa la app en tiempo real |
| `DATABASE_URL_SUPERADMIN` | Usuario `superadmin_user` — solo lectura agregada, panel `/superadmin` |
| `DATABASE_URL_TRABAJADOR` | Usuario `trabajador_user` — solo puede tocar `avisos_ml` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk, lado del navegador |
| `CLERK_SECRET_KEY` | Clerk, lado del servidor |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | App de Mercado Libre (OAuth) — `ML_CLIENT_ID` además valida que un aviso que llega a `/api/ml/webhooks` sea de verdad nuestro |
| `ML_TOKEN_KEY_V1` / `ML_TOKEN_KEY_V2` | Claves de cifrado de los tokens de Mercado Libre (versión de clave, para poder rotarla) — V2 todavía no existe, se usa cuando toque rotar |
| `TRABAJADOR_SECRET` | Secreto compartido que valida al cron que llama a `/api/ml/trabajador` (comparado con `crypto.timingSafeEqual`, no `===`) |
| `LIMITE_PETICIONES_POR_IP` / `LIMITE_PETICIONES_POR_USUARIO` | Opcionales — suben el límite de peticiones del middleware (pensado para pruebas manuales en staging, nunca para producción) |
| `RAILWAY_PUBLIC_DOMAIN` | La pone Railway sola — dominio público real, para armar links (ej. invitaciones) sin depender del header `host` |

**Deuda conocida del límite de peticiones (tarea 1.10)**, documentada acá para no perderla: la IP se toma del primer valor de `x-forwarded-for`, que un cliente puede falsificar; y el contador vive en memoria del proceso, así que se reinicia en cada deploy. Suficiente para hoy (un solo servicio `web`, sin abuso real que proteger todavía), no para cuando haya más de una instancia.

## Próximos pasos pensados (en orden)

1. **Arreglar el middleware** (este PR, `fix-middleware-rutas-maquina`): rutas de máquina públicas con su propia autenticación, `/api/*` sin sesión → 401 inmediato, `/login` → `/sign-in`, sin depender del rewrite de Clerk que se cuelga. Es la prioridad real — bloquea la tarea 2.4 y cualquier prueba real con Mercado Libre, y no depende de que Railway se recupere.
2. Confirmar que el túnel privado a Postgres de staging ya responde; comprobar `drizzle.__drizzle_migrations` ahí; aplicar la migración y `db/rls-setup.sql` de las tareas 2.9 y 2.10 contra staging y producción (resolviendo antes la colisión de numeración, ver "Problemas conocidos §3"), correr sus pruebas contra una base real, y recién ahí abrir y fusionar sus Pull Requests.
3. Probar la tarea 2.11a ("Publicar producto y clip") contra una cuenta real de Mercado Libre — es la única parte del flujo (el endpoint de subir un Clip/video) que nunca se confirmó en vivo.
4. Construir las sub-tareas 2.11b, 2.11c y 2.11d (Promociones, Programar Full, Alertas sanitarias), una por una, cada una en su propio Pull Request.
5. Retomar la tarea 2.8 (inventario por bodega) cuando Mateo y Franky definan qué es una "bodega en tránsito" en este sistema.
6. Retomar la integración con FullyLemon (aviso de cambio de estado de guía) cuando respondan con el contrato real de su endpoint.
7. Ejecutar la mudanza de dominio ya decidida (`app.zilonix.com` / `os.zilonix.com`).
