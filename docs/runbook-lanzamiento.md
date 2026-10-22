# Runbook de lanzamiento y guardia de diciembre (Z-RL-04)

Procedimiento para quien está de guardia. Cubre el rollback de un release, Mercado Libre (tópicos y app desconectada), la rotación de `TRABAJADOR_SECRET`, dónde está la rotación de la clave de tokens, el incidente de Railway del 21-oct-2026 y los contactos de diciembre.

Ningún valor de secreto, token ni cadena de conexión va en este archivo, en un issue, en un chat ni en un comando que quede en el historial. Si un comando falla, se anota el código de salida y la frase corta, no el mensaje completo.

Los dos ambientes de Railway son distintos y cada uno tiene sus propios valores. El nombre del ambiente en el CLI, el que usa `README.md`, es `production`. La rama de git del release es `produccion` (sin tilde). Staging y producción no comparten un secreto.

## Documentos relacionados

Estos dos archivos se enlazan desde acá y **el 2026-10-22 no están en `main`**. El enlace relativo no resuelve hasta que se fusionen.

| Documento | Qué cubre | Dónde está hoy |
|---|---|---|
| [`docs/rotacion-claves.md`](rotacion-claves.md) | Rotación de la clave que cifra los tokens de Mercado Libre | [PR #80](https://github.com/mateodta2-code/zilonix-plataforma/pull/80), abierto, sin fusionar |
| [`docs/runbook-backups.md`](runbook-backups.md) | Backups de Postgres y ensayo de restauración en una base temporal | [PR #85](https://github.com/mateodta2-code/zilonix-plataforma/pull/85), abierto, sin fusionar |

## 1. Rollback de un release

El release que está publicado es la punta de la rama `produccion`. El 2026-10-22 esa rama y `main` apuntaban al mismo commit. El CI (chequeo `build-and-test` de `.github/workflows/ci.yml`) corre en push y en Pull Request hacia `main` y hacia `produccion`.

`/api/version` devuelve `{"version":"..."}` con el campo `version` de `package.json` de **ese** build (`lib/version.ts`). El pie de página muestra el mismo número (`Zilonix v…`). El 2026-10-22, staging (`https://web-staging-d979.up.railway.app/api/version`) y producción (`https://web-production-af270.up.railway.app/api/version`) respondieron `{"version":"0.1.0"}`. Si el release que se revierte no cambió `package.json`, el JSON sigue igual: un 200 confirma que el servicio responde, y el commit del deployment en Railway confirma cuál es el código.

Un `git revert` deshace código. No deshace una migración ya aplicada en Postgres. Si el release malo ya corrió migraciones contra producción, parar y usar el runbook de backups (enlace de arriba) antes de tocar la base. Este archivo no trae SQL de rollback.

### 1.1. Revertir el release en `produccion`

1. Anotar, antes de tocar nada, el commit que Railway muestra como deployment activo del servicio `web` en el ambiente `production`, y la respuesta de:

   ```bash
   curl -sS "https://web-production-af270.up.railway.app/api/version"
   ```

2. Traer la rama y ver qué commit es el release que hay que sacar:

   ```bash
   git fetch origin produccion
   git log --oneline origin/produccion -15
   ```

3. Crear una rama desde `origin/produccion` (no desde `main`, el día que hayan divergido). Revertir ahí. Si el release es un merge, `-m 1` se queda con el primer padre (la punta anterior de `produccion`). Si entró como un solo commit, el revert es sin `-m`. Varios commits se revierten del más nuevo al más viejo.

   ```bash
   git checkout -b rollback/descripcion-corta origin/produccion
   git revert -m 1 <sha-del-merge>
   ```

4. Abrir un Pull Request hacia `produccion`. Esperar el chequeo `build-and-test` en verde y recién ahí fusionar. Sin force-push y sin `git reset` sobre `produccion`.

### 1.2. Redeploy en Railway

El deploy de este repo es automático al pushear, o `railway redeploy` cuando hay que repetir el mismo build. `railway up` no se usa.

1. En el dashboard, servicio `web` del ambiente `production`: confirmar qué rama despliega. El revert vive en `produccion`. Si ese servicio sigue despliegando `main`, un redeploy reconstruye `main` y el revert no sale a producción.
2. Si al fusionar el PR se abrió solo un deployment con el commit del revert, esperar a que quede activo.
3. Si no se abrió, en una máquina con `railway login` y el proyecto ya enlazado, repetir el build del servicio que ya se confirmó en el paso 1:

   ```bash
   railway redeploy --service web --environment production
   ```

   Confirmar en el CLI que el servicio es `web` y el ambiente es `production` antes de aceptar. Un cambio de variables también reinicia `web`; no hace falta para un revert que solo mueve el commit.

### 1.3. Confirmar con `/api/version`

1. Cuando el deployment figura activo:

   ```bash
   curl -sS "https://web-production-af270.up.railway.app/api/version"
   ```

   La respuesta esperada es `{"version":"<version de package.json>"}` del commit en el que quedó `origin/produccion` después del revert. Se compara contra:

   ```bash
   git show origin/produccion:package.json
   ```

   Solo interesa el campo `version`. El mismo número tiene que verse en el pie de página.
2. En Railway, el commit del deployment activo es el del revert.
3. El 2026-10-22 ese campo es `0.1.0` en los dos ambientes. Con un release que no haya subido la versión, el JSON de antes y el de después coinciden: la prueba de que salió el revert es el commit del deployment, y `/api/version` prueba que ese proceso responde.
4. Staging se mira aparte, en `https://web-staging-d979.up.railway.app/api/version`. Revertir `produccion` no mueve el deployment de staging (staging despliega `main`, `docs/ESTADO.md`).

## 2. Mercado Libre desactiva los tópicos o desconecta la app

La app de este producto en Mercado Libre Developers es **Zilonix Plataforma**. Zilonix OS y Zilonix Staging QA son otras apps; no se reactivan ni se les copian credenciales. El repo no guarda la lista de tópicos que quedaron marcados en ese panel. Lista que había que volver a prender: [COMPLETAR].

Hay dos fallos distintos.

### 2.1. Desactiva los tópicos (el callback de avisos)

Mercado Libre hace `POST` a `/api/ml/webhooks` con `resource`, `user_id`, `topic`, `sent` (y otros campos que la ruta no exige). La ruta responde 200 y solo inserta el aviso; el procesamiento es otro proceso (`lib/ml/trabajador.ts`). El comentario de `app/api/ml/webhooks/route.ts` registra la causa real: si el 200 no llega a tiempo, Mercado Libre reintenta y, después de varios fallos seguidos, puede desactivar el callback. Por eso la ruta responde 200 también con un cuerpo incompleto o con una cuenta que no es nuestra. Un 4xx o un 5xx en esa ruta es lo que empuja a desactivar el tópico.

Síntoma en el producto: `/panel/avisos-ml` deja de sumar recibidos. El trabajador solo procesa filas ya guardadas (`procesado_ts` vacío). El silencio no significa que no haya ventas.

1. Confirmar que el servicio responde:

   ```bash
   curl -sS "https://web-production-af270.up.railway.app/api/version"
   ```

   En staging, el mismo path sobre `https://web-staging-d979.up.railway.app`. El 2026-10-22 los dos devolvieron 200 con `{"version":"0.1.0"}` (el de staging salió de caché del edge, cabecera `x-nextjs-cache: HIT`).
2. Confirmar que **esta** ruta contesta 200 rápido, sin sesión. Un POST sin secreto y con cuerpo `{}` es suficiente: no lleva tokens. Lo que se espera, si llega a `app/api/ml/webhooks/route.ts`, es HTTP 200 y un JSON `{"ok":false,"motivo":"cuerpo incompleto"}`. El 2026-10-22 ese POST contra staging no recibió bytes en 20 segundos, a diferencia del GET de `/api/version`. Hay que repetirlo desde la red de la guardia y anotar el código HTTP. Si tarda, redirige a `/sign-in` o responde un 401 de Clerk, el handler no está contestando: volver a prender el tópico lo va a apagar otra vez.
3. Dato de código para ese chequeo: `middleware.ts` llama `auth.protect()` en toda ruta que no esté en su lista pública, y `/api/ml/webhooks` no está en esa lista (sí está exenta de `requierePermiso`, que es otra capa). Arreglar la lista es un cambio de código con Pull Request, no un clic en Railway. Este runbook no lo cambia.
4. En Mercado Libre Developers, app Zilonix Plataforma, volver a activar los tópicos de notificaciones y confirmar que la URL de callback de **avisos** es `https://<dominio-publico-de-ese-ambiente>/api/ml/webhooks`. Dominios de hoy: staging `web-staging-d979.up.railway.app`, producción `web-production-af270.up.railway.app`. La URL de OAuth es otra (`/api/ml/callback`); dejarla como está si el fallo es solo de tópicos. Cuando se ejecute la mudanza a `app.zilonix.com` (decisión D7, todavía pendiente), esa URL de callback hay que registrarla de nuevo, igual que la de OAuth.
5. El código no se suscribe a tópicos por API. Se prenden en el panel, los mismos que ya estaban (el hueco [COMPLETAR] de arriba). La tarea 2.1 dejó los permisos de la app al mínimo a propósito; no se activan módulos que el producto todavía no usa.
6. Un aviso de una cuenta conectada queda en `avisos_ml`. Uno con `user_id` desconocido responde 200 y no se guarda. El mismo aviso reintentado no se duplica (índice único por cuenta, tema, recurso y momento de envío).
7. El trabajador tiene que estar corriendo para que lo guardado pase a procesado. En staging lo llama el cron de la sección 3, cada minuto. En producción ese cron todavía no existe.

### 2.2. Desconecta la app o la autorización del vendedor

Desconectar, en este código, marca `desconectada_ts` en `cuentas_ml`. No borra la fila ni el histórico. Borrar la fila a mano no reconecta nada.

- Si falla la autorización de **un** vendedor (refresh rechazado, el vendedor revocó el permiso): esa persona vuelve a entrar por `/panel/conectar-ml`. Hace falta el permiso de configuración para crear. El refresh token de Mercado Libre vale una sola vez; dos renovaciones juntas invalidan la cuenta (el candado está en `lib/ml/cuentas.ts`). Rotar `ML_TOKEN_KEY_V1` no arregla un token que Mercado Libre ya rechazó.
- Si cae la **app** entera: en Developers, Zilonix Plataforma tiene que seguir activa, con "Refresh Token" prendido en los flujos OAuth (el 2026-10-20 el primer TESTUSER falló porque eso estaba apagado) y con las URLs de redirect de staging y producción. `ML_CLIENT_ID` y `ML_CLIENT_SECRET` se cambian solo si Mercado Libre emite un par nuevo, y se cargan en el servicio `web` de cada ambiente. El canje y la renovación los mandan (`lib/ml/oauth.ts`). Si después de eso la renovación falla, cada vendedor reconecta desde `/panel/conectar-ml`. No se crea una app nueva para salir del paso.

## 3. Rotación de `TRABAJADOR_SECRET`

El código compara un solo valor. No hay ventana con el secreto viejo y el nuevo a la vez. Un minuto sin coincidir no borra avisos: la ruta responde 401 y `procesado_ts` sigue vacío. El lote siguiente toma hasta 50 pendientes (`TAMAÑO_LOTE` en `lib/ml/trabajador.ts`).

### 3.1. Dónde se usa y quién lo necesita

| Dónde | Nombre | Para qué |
|---|---|---|
| `app/api/ml/trabajador/route.ts` | variable `TRABAJADOR_SECRET` | Compara el header `x-trabajador-secret`. Si falta la variable, o no coincide, responde 401 y `{ ok: false }`. Si coincide, corre `procesarAvisosPendientes()`. |
| Railway, servicio `web`, cada ambiente | variable `TRABAJADOR_SECRET` | Es el proceso que atiende esa ruta. No hay un servicio Railway aparte para el trabajador (la decisión D4 sigue pendiente; el changelog de la tarea 2.4 lo deja explícito). |
| `.github/workflows/trabajador-avisos-ml.yml` | secreto de Actions `TRABAJADOR_SECRET_STAGING` | Cron `* * * * *` y disparo manual. Hace `POST` a `https://web-staging-d979.up.railway.app/api/ml/trabajador` con ese header. `curl -sf` marca el job como fallido ante cualquier respuesta que no sea 2xx. El `--max-time` es 60 segundos. |
| Producción | — | Ese workflow no llama a producción. El comentario del archivo dice de agregar un workflow gemelo antes de conectar cuentas reales ahí. Hoy no existe, así que en producción el único consumidor de la variable es el servicio `web`, y nadie la está mandando. |

`TRABAJADOR_SECRET_STAGING` no está en `.env.example` ni la lee `process.env`. Tiene que ser el mismo valor que `TRABAJADOR_SECRET` del `web` de **staging**, y distinto del de producción.

### 3.2. Rotarla sin dejar el trabajador caído

Staging primero. Producción solo cuando el cron de staging ya quedó en verde, y solo si de verdad hay que rotar ese ambiente.

1. Una persona genera el valor (`openssl rand -base64 32` sirve; la ruta no exige los 32 bytes, a diferencia de `ML_TOKEN_KEY_V1`). Se guarda en el gestor de secretos. No se pega en el chat, en el issue ni en este archivo. No se reutiliza una clave de tokens ni una contraseña de base.
2. No vaciar la variable en Railway "mientras tanto": con la variable ausente, toda llamada da 401 hasta que el proceso nuevo esté arriba.
3. Cargar el valor nuevo en `TRABAJADOR_SECRET` del servicio `web` de **ese** ambiente y guardar. Railway reinicia `web`. Mientras el deployment viejo sigue recibiendo tráfico, el cron sigue entrando con el valor viejo. El reinicio también corta un momento `/api/ml/webhooks`; mirar la sección 2 si Mercado Libre está sensible a los 200.
4. Esperar a que el deployment nuevo esté activo y a que `GET /api/version` de ese ambiente responda 200. A partir de ahí el proceso solo acepta el valor nuevo: el cron, si sigue con el viejo, recibe 401. Esa es la ventana, y es corta si el paso 5 se hace enseguida.
5. En staging, actualizar el secreto de GitHub Actions `TRABAJADOR_SECRET_STAGING` al mismo valor. Actualizarlo **antes** de que el deployment nuevo esté activo deja al cron en 401 durante todo el reinicio. En producción no hay secreto de Actions que actualizar, hasta que exista el workflow gemelo.
6. Disparar a mano el workflow "Procesar avisos pendientes de Mercado Libre (staging)" (`workflow_dispatch`). El job en verde significa que el `curl` recibió 2xx. El cuerpo es `{ ok: true, recibidosPendientes, procesados, fallidos }`: son conteos, se puede leer en el log de Actions. Un 401 es secreto desparejo; los avisos siguen pendientes y se vuelve a correr el workflow después de igualar los dos valores. No armar un `curl` a mano con el header: el secreto quedaría en el historial de la terminal.
7. En `/panel/avisos-ml`, los pendientes de una empresa con avisos no tienen que seguir creciendo sin bajar a lo largo de dos minutos del cron.

El mismo chequeo del paso 2 de la sección 2.1 aplica a `/api/ml/trabajador`: si la respuesta es la de Clerk y no el JSON `{ ok: false }` de la ruta, rotar el secreto no levanta el trabajador.

## 4. Rotación de la clave de tokens

El procedimiento está en [`docs/rotacion-claves.md`](rotacion-claves.md) ([PR #80](https://github.com/mateodta2-code/zilonix-plataforma/pull/80), sin fusionar el 2026-10-22).

Ese documento es el que hay que seguir cuando entre a `main`: agrega `ML_TOKEN_KEY_V2`, pasa la versión actual a 2, re-cifra las filas con `npm run tokens:recifrar` y recién entonces permite borrar `ML_TOKEN_KEY_V1`. Borrar la clave vieja antes de re-cifrar deja esas cuentas sin poder descifrar.

En el `main` de hoy el código todavía no es ese. `lib/cifrado.ts` tiene `CLAVE_ACTUAL = 1` fijo y lee `ML_TOKEN_KEY_V<version>` según el número guardado en cada fila. No hay script de re-cifrado en `main`. No se rota producción editando `CLAVE_ACTUAL` a mano como atajo, ni se borra `ML_TOKEN_KEY_V1` desde este runbook.

## 5. Incidente del proveedor (Railway, 21-oct-2026)

Qué ya está escrito en `docs/ESTADO.md`, sin repetir valores: desde el 2026-10-21 a las 07:24 UTC, el dashboard, el build y parte de la API de Railway fallaban (`status.railway.com`). El túnel privado a Postgres agotaba el tiempo de espera. El CI de GitHub no depende de Railway. Quedaron frenadas las migraciones, `db/rls-setup.sql` y la verificación contra la base real.

**Qué se hizo realmente ese día (rotaciones, reinicios, variables tocadas):** [COMPLETAR por Mateo]. El changelog del 21-oct no registra una rotación de secretos por este incidente.

Lista de rotación, solo nombres. Salen de lo que el código lee con `process.env` y de `.env.example`. Cada ambiente (staging y `production`) tiene su copia en el servicio `web`, salvo `RAILWAY_PUBLIC_DOMAIN` y `NODE_ENV`, que pone el runtime. Staging primero, y el valor nuevo de un ambiente no se copia al otro.

| Variable | Servicio | Dónde aparece el nombre | ¿Se rota? | Hecho el 21-oct-2026 |
|---|---|---|---|---|
| `DATABASE_URL` | Postgres | `process.env` en `db/migrate.ts` y `drizzle.config.ts`. También `.env.example`. Superusuario, solo migraciones | Sí. La contraseña es la del rol dentro de esa variable; tiene que coincidir con Postgres. Se cambia por el túnel privado | [COMPLETAR por Mateo] |
| `DATABASE_URL_APP` | Postgres | `process.env` en `db/index.ts`. También `.env.example`. Rol `app_user` | Sí. Mismo criterio. El alta original está descrita en `docs/rls.md` | [COMPLETAR por Mateo] |
| `DATABASE_URL_SUPERADMIN` | Postgres | `process.env` en `db/superadmin-context.ts`. Rol `superadmin_user` | Sí | [COMPLETAR por Mateo] |
| `DATABASE_URL_TRABAJADOR` | Postgres | `process.env` en `db/trabajador-context.ts`. Rol `trabajador_user`, solo `avisos_ml` | Sí | [COMPLETAR por Mateo] |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk | `process.env` en `next.config.mjs`. También `.env.example` | Sí, en pareja con `CLERK_SECRET_KEY`, desde el dashboard de la app Clerk "Zilonix Plataforma". Es la llave pública; igual se cambia si se rota la instancia. Pegar las dos llaves en una sola variable tumbó un build (nota de `.env.example`) | [COMPLETAR por Mateo] |
| `CLERK_SECRET_KEY` | Clerk | `.env.example`. La consume `@clerk/nextjs`; en este repo no hay un `process.env.CLERK_SECRET_KEY` | Sí, en pareja con la llave pública | [COMPLETAR por Mateo] |
| `ML_CLIENT_ID` | Mercado Libre | `process.env` en `lib/ml/oauth.ts` (`requerirVariable`) | Sí, solo si Mercado Libre emite otro par para la app Zilonix Plataforma | [COMPLETAR por Mateo] |
| `ML_CLIENT_SECRET` | Mercado Libre | `process.env` en `lib/ml/oauth.ts` | Sí, junto con `ML_CLIENT_ID`. Lo usan el canje del code y la renovación del refresh | [COMPLETAR por Mateo] |
| `ML_TOKEN_KEY_V1` | propia | `process.env["ML_TOKEN_KEY_V" + version]` en `lib/cifrado.ts`. Cifra tokens de Mercado Libre. Clave nuestra, no la emite Mercado Libre | Sí, con el procedimiento de la sección 4. En `main` la versión actual es 1 | [COMPLETAR por Mateo] |
| `ML_TOKEN_KEY_V2` | propia | El mismo `process.env` dinámico, cuando la fila dice versión 2. `docs/ESTADO.md` (21-oct) dice que V2 todavía no existe | Sí, el día que la sección 4 esté en `main` y se esté rotando. Antes de eso no hay valor que rotar | [COMPLETAR por Mateo] |
| `TRABAJADOR_SECRET` | propia | `process.env` en `app/api/ml/trabajador/route.ts` | Sí. Sección 3. Al rotarla, el secreto de Actions `TRABAJADOR_SECRET_STAGING` va en la misma ventana | [COMPLETAR por Mateo] |
| `LIMITE_PETICIONES_POR_IP` | propia | `process.env` en `middleware.ts`. Opcional. Sin ella el límite es 180 por minuto | No es secreto. En producción se deja sin definir: el changelog del 21-oct dice que subirla es para pruebas en staging | no aplica |
| `LIMITE_PETICIONES_POR_USUARIO` | propia | `process.env` en `middleware.ts`. Opcional. Sin ella el límite es 300 por minuto | No es secreto. Mismo criterio que la fila anterior | no aplica |
| `RAILWAY_PUBLIC_DOMAIN` | propia | `process.env` en `lib/url-publica.ts` | No es secreto. Railway la inyecta con el dominio público. No se setea a mano: de ahí salen los links de invitación y la URL de callback de OAuth | no aplica |
| `NODE_ENV` | propia | `process.env` en `next.config.mjs` (la CSP permite `unsafe-eval` cuando no es `production`) | No es secreto. La pone el runtime. No se usa para rotar credenciales | no aplica |

`.env.example` nombra cuatro de estas: `DATABASE_URL`, `DATABASE_URL_APP`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`. El resto de la tabla sale solo del código.

El cron de avisos, además, usa el secreto de GitHub Actions `TRABAJADOR_SECRET_STAGING` (no está en la tabla porque no es `process.env` de la app ni está en `.env.example`). Si el 21-oct se rotó: [COMPLETAR por Mateo].

## 6. Contactos

Sin nombres, teléfonos ni correos inventados. Quien complete la tabla los carga acá, no en un issue público si el número es personal.

| Función | Nombre | Teléfono | Correo | Cuándo se llama |
|---|---|---|---|---|
| Producto / decisión de parar un release | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| Guardia técnica | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| Quién puede entrar a Railway (staging y production) | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| Quién puede entrar a Clerk (app Zilonix Plataforma) | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| Quién puede entrar a Mercado Libre Developers (app Zilonix Plataforma) | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| Escalamiento si la guardia no contesta | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |

## 7. Guardia del 21 al 31 de diciembre de 2026

Una persona por día, con un respaldo. Los huecos quedan vacíos a propósito.

| Fecha | Día | Guardia | Teléfono | Correo | Respaldo |
|---|---|---|---|---|---|
| 2026-12-21 | lunes | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-22 | martes | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-23 | miércoles | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-24 | jueves | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-25 | viernes | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-26 | sábado | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-27 | domingo | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-28 | lunes | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-29 | martes | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-30 | miércoles | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2026-12-31 | jueves | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |

Quien esté de guardia ese día usa las secciones 1 a 5. Si el fallo es de datos y no de un release, el camino es el runbook de backups (PR #85), no un revert.
