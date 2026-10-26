# Llevar "Seguimiento" (issue #175) a producción

Checklist en español simple, para Sharel — los pasos están en el orden en que hay que hacerlos, no te saltes ninguno. Ningún paso de este documento tiene un secreto real adentro; donde haga falta uno, dice dónde conseguirlo, nunca cuál es.

Antes de arrancar: esto se hace DESPUÉS de que las pantallas de Seguimiento (issues #191–#195, las hace Code 1) ya estén en `main` y probadas en staging — no antes.

## 1. Mergear la UI a `main`, y `main` a `produccion`

1. Confirmar que el/los PR de la UI de Seguimiento (#191–#195) ya están fusionados a `main`, con CI en verde.
2. Abrir el PR de release de siempre: `main` → `produccion`. Ese PR es el que sube la versión de `package.json` (regla del repo: la versión solo sube ahí, nunca en un PR normal).
3. Una vez fusionado ese PR, Railway despliega solo el servicio de producción (push a `produccion` → deploy automático). Nunca `railway up`.
4. Confirmar que terminó: `curl https://web-production-af270.up.railway.app/api/version` tiene que devolver la versión nueva.

## 2. SQL en el Postgres de producción

**Antes de correr nada**: abrir el túnel privado (nunca exponer la base a internet):
```
railway connect <servicio-postgres-de-produccion> --environment production --tunnel-only
```
Con la URL que imprime el túnel, conectarse con **`psql` real** — nunca con la pestaña "Data" del dashboard de Railway (esa trae un `LIMIT` implícito que puede hacer pensar que algo salió mal cuando no salió mal).

### 2.1 Migraciones `0008`–`0010`, si faltan

Primero confirmar si la de seguimiento ya está aplicada:
```sql
SELECT to_regclass('public.seguimientos_ml');
```
Si devuelve `NULL`, falta — correr las migraciones:
```
DATABASE_URL="<la-url-del-túnel>" npm run db:migrate
```
**Importante (lección real de este release, ver 2.5)**: `db:migrate` aplica TODAS las migraciones pendientes de una, en orden — nunca correrlo pensando solo en la `0009`. En producción, al momento de este release, faltaban la `0008` (despachos_ml), la `0009` (seguimiento) Y la `0010` (productos_ml/publicar) — las tres de una, no solo la última que se tenía en mente. Si `to_regclass` ya da algo distinto de `NULL` para `seguimientos_ml`, igual vale la pena correr `db:migrate` una vez para confirmar que no quedó ninguna otra pendiente suelta (es idempotente, nunca rompe nada si ya todo está aplicado).

Si devuelve algo distinto de `NULL` (la tabla ya existe) Y `db:migrate` confirma que no hay nada pendiente, seguir directo al punto 2.2.

### 2.2 Rol `seguimiento_trabajador_user` + GRANTs + 5 políticas RLS

**Exactamente el mismo bloque que ya se usó para staging** — idempotente, se puede pegar más de una vez sin romper nada. Las políticas van ANTES de activar RLS (para que no haya ninguna ventana de "todo denegado" entre un `ALTER TABLE` y la política correspondiente):

```sql
-- 1. Rol — reemplazar el placeholder por la contraseña real ANTES de
-- pegar (nunca ejecutar con el texto placeholder tal cual).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'seguimiento_trabajador_user') THEN
    CREATE ROLE seguimiento_trabajador_user WITH LOGIN PASSWORD 'REEMPLAZAR_ACA_ANTES_DE_CORRER';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO seguimiento_trabajador_user;
GRANT USAGE ON SCHEMA public TO seguimiento_trabajador_user;
GRANT SELECT ON seguimientos_ml TO seguimiento_trabajador_user;
GRANT UPDATE (ultima_revision_ts) ON seguimientos_ml TO seguimiento_trabajador_user;

-- 2. Políticas (inertes hasta el paso 3).
DROP POLICY IF EXISTS aislamiento_seguimientos_ml ON seguimientos_ml;
CREATE POLICY aislamiento_seguimientos_ml ON seguimientos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_seguimiento_fotos ON seguimiento_fotos;
CREATE POLICY aislamiento_seguimiento_fotos ON seguimiento_fotos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_seguimiento_alertas ON seguimiento_alertas;
CREATE POLICY aislamiento_seguimiento_alertas ON seguimiento_alertas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS seguimiento_trabajador_lee_seguimientos_ml ON seguimientos_ml;
CREATE POLICY seguimiento_trabajador_lee_seguimientos_ml ON seguimientos_ml FOR SELECT TO seguimiento_trabajador_user USING (true);
DROP POLICY IF EXISTS seguimiento_trabajador_marca_revision_seguimientos_ml ON seguimientos_ml;
CREATE POLICY seguimiento_trabajador_marca_revision_seguimientos_ml ON seguimientos_ml FOR UPDATE TO seguimiento_trabajador_user USING (true);

-- 3. Recién ahora se activa RLS.
ALTER TABLE seguimientos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimientos_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_fotos FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_alertas FORCE ROW LEVEL SECURITY;
```

### 2.3 Contraseña — nunca en el chat ni en un commit

- Revisar en Railway (ambiente de producción) si la variable `DATABASE_URL_SEGUIMIENTO` ya existe y qué contraseña tiene puesta en su URL (`postgresql://seguimiento_trabajador_user:<contraseña>@host:puerto/railway`).
- Si no existe todavía: generar una contraseña fuerte nueva, usarla en el `CREATE ROLE` de arriba, y crear la variable `DATABASE_URL_SEGUIMIENTO` en Railway con el mismo host/puerto/nombre de base que ya usan `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` en producción (copiarlo de cualquiera de esas, nunca escribirlo de memoria).
- Si ya existe: usar esa misma contraseña en el `CREATE ROLE` (o en un `ALTER ROLE seguimiento_trabajador_user WITH PASSWORD '<esa-contraseña>';` si el rol ya estaba creado de antes con otra).

### 2.4 Chequeos finales (psql real)

```sql
\du seguimiento_trabajador_user
SELECT polname FROM pg_policies WHERE tablename LIKE 'seguimiento%';
```
El primero: el rol existe, con `Login`, sin `Superuser`/`Createrole`. El segundo: 5 filas — `aislamiento_seguimientos_ml`, `aislamiento_seguimiento_fotos`, `aislamiento_seguimiento_alertas`, `seguimiento_trabajador_lee_seguimientos_ml`, `seguimiento_trabajador_marca_revision_seguimientos_ml`.

## 2.5 Postmortem real: "Application error" en producción al agregar — RESUELTO (issue #207)

Síntoma observado: agregar un seguimiento en producción (desde la extensión o desde el formulario) terminaba en la pantalla genérica de Next.js ("Application error", digest `2846050239`) en vez del aviso normal.

**Diagnóstico inicial (incompleto)**: se sospechó solo un password mismatch del rol `seguimiento_trabajador_user` contra `DATABASE_URL_SEGUIMIENTO`. Real, pero no era la causa completa — ni la más grave.

**Causa real confirmada, de más grave a menos**:
1. **`DATABASE_URL_APP` (la variable que usa TODO el tráfico normal de la app — no solo Seguimiento) estaba apuntando al rol `seguimiento_trabajador_user` en vez de a `app_user`.** `seguimiento_trabajador_user` solo tiene `SELECT`/`UPDATE` acotado sobre `seguimientos_ml` (ver 2.2) — con esa variable mal apuntada, prácticamente ninguna consulta de negocio real podía funcionar, mucho más allá de Seguimiento. Esta es la que de verdad importa para cualquier incidente futuro: **`DATABASE_URL_APP` SIEMPRE tiene que apuntar a `app_user`, nunca a ningún rol restringido** (regla ya en `CLAUDE.md`, pero el valor real en Railway producción no la cumplía).
2. Las migraciones `0008`/`0009`/`0010` nunca se habían corrido contra el Postgres de producción (ver 2.1 actualizado) — ni las tablas de seguimiento ni `productos_ml` existían todavía.
3. El rol `seguimiento_trabajador_user` tampoco existía (ni sus 5 políticas RLS).

**Ya resuelto por Pablo en producción (NO rehacer estos pasos — son ops reales ya aplicadas)**:
- Migraciones `0008`–`0010` aplicadas contra el Postgres de producción.
- Rol `seguimiento_trabajador_user` creado + las 5 políticas RLS de la sección 2.2.
- `DATABASE_URL_APP` corregida en Railway (producción) para apuntar a `app_user` con `APP_USER_PASSWORD_TEMPORAL` — mismo criterio que ya usa staging.
- Empresa de prueba creada en producción, sin "Application error".
- Smoke test real de "Seguir en Zilonix" en verde: `?agregado=1` real en `web-production-af270.up.railway.app`.

**Qué queda** (nada de SQL/RLS — eso ya está): el secreto de GitHub `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION` y una corrida de `workflow_dispatch` para confirmar el batch diario de verdad — ver secciones 3 y 4 de este documento, sin cambios. **El `schedule` del workflow sigue sin activarse.**

## 3. Variables y secretos

- `DATABASE_URL_SEGUIMIENTO` y `SEGUIMIENTO_TRABAJADOR_SECRET` (variable de Railway, producción) — deberían existir ya; si no, armarlas ahora (ver punto 2.3 para la primera; la segunda es un secreto compartido nuevo, cualquier cadena larga y aleatoria).
- **GitHub → Settings → Secrets and variables → Actions**: crear `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION` con el MISMO valor que `SEGUIMIENTO_TRABAJADOR_SECRET` tiene en Railway producción (copiar el valor de Railway a GitHub, nunca inventar uno distinto — si no coinciden, el workflow va a dar 401).

### 3.1 Batch prod — secreto GH + workflow_dispatch (lo único que falta, issue #207)

El SQL/RLS de producción y el smoke de "Seguir en Zilonix" ya están resueltos (ver 2.5) — esto es lo único operativo que queda, resumido en un solo lugar para no tener que releer todo el documento:

1. **Secreto exacto a crear**: `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION`, en **GitHub → Settings → Secrets and variables → Actions → New repository secret**. El valor tiene que ser EXACTAMENTE el mismo que ya tiene la variable `SEGUIMIENTO_TRABAJADOR_SECRET` en Railway (ambiente de producción del servicio `web-production-af270`) — copiarlo de ahí, nunca inventar uno nuevo ni escribirlo de memoria. Si no coinciden carácter por carácter, el workflow va a dar `401` (secreto comparado con `crypto.timingSafeEqual` en `app/api/trabajos/seguimiento/route.ts`).
2. **Qué workflow disparar**: GitHub → Actions → **"Revisión diaria de seguimientos de Mercado Libre (producción)"** (`.github/workflows/revision-diaria-seguimiento-produccion.yml`) → **Run workflow**. No tiene ningún input que llenar — el workflow no define ninguno (`workflow_dispatch: {}`), solo hace falta elegir la rama (`main`) y confirmar.
3. **NO activar el cron todavía**: el bloque `schedule` de ese mismo archivo sigue comentado a propósito — no descomentarlo en esta tarea, ni en ninguna corrida manual (ver paso 5 de la sección 4, para cuando corresponda).
4. **Cómo verificar que la corrida guardó fotos de verdad** (nunca asumir solo porque el paso de GitHub Actions salió verde):
   - En el log de esa corrida (pestaña del job en GitHub Actions) no hay nada más que imprimir — el `curl` solo confirma que la petición HTTP llegó.
   - El dato real está en Postgres: con el mismo túnel/`psql` de la sección 2,
     ```sql
     SELECT seguimiento_id, fecha, precio, vendidos FROM seguimiento_fotos ORDER BY creado_ts DESC LIMIT 5;
     ```
     tiene que aparecer al menos una fila con la fecha de hoy (igual que el paso 3 de la sección 4 — mismo chequeo, repetido acá para no tener que ir a buscarlo).
   - Si se tiene acceso a los logs del servicio `web` en Railway (producción) del momento exacto de la corrida, la línea real que deja el trabajo es `[lib/trabajos/revisionDiariaSeguimiento] lote del día: N activos, N procesados, N saltados, N con error, N alertas creadas.` (`lib/trabajos/revisionDiariaSeguimiento.ts`) — confirma cuántos seguimientos se intentaron sin tener que contarlos a mano en la tabla.
5. **Qué NO hacer en este paso** (además de lo ya dicho en "Qué NO hacer" al final del documento):
   - Nunca tocar `DATABASE_URL_APP` para esto — ese incidente ya está resuelto (2.5), y esta tarea es solo del secreto de GitHub y el workflow, no de ninguna variable de conexión.
   - Nunca apuntar `app_user` (ni `DATABASE_URL_APP`) al rol `seguimiento_trabajador_user`, ni al revés — son roles con privilegios distintos a propósito (ver 2.5, punto 1).
   - Nunca activar el `schedule` del workflow en este paso — eso es un commit aparte, después de confirmar varias corridas manuales en verde (sección 4, paso 5).

## 4. Correr el workflow una vez, a mano, y verificar

1. GitHub → Actions → **"Revisión diaria de seguimientos de Mercado Libre (producción)"** → **Run workflow** (`workflow_dispatch` — el cron automático todavía está comentado en `.github/workflows/revision-diaria-seguimiento-produccion.yml`, a propósito).
2. Confirmar que la corrida termina en verde (ningún `curl` con `-f` falla silencioso — si el secreto no coincide o falta una variable, el paso se ve rojo).
3. Verificar que de verdad guardó fotos — con el mismo túnel/psql del paso 2:
   ```sql
   SELECT seguimiento_id, fecha, precio, vendidos FROM seguimiento_fotos ORDER BY creado_ts DESC LIMIT 5;
   ```
   Tiene que aparecer al menos una fila con la fecha de hoy.
4. Repetir el Run workflow una o dos veces más en los días siguientes (a mano) antes de confiar en que el cron automático va a andar solo.
5. **Recién cuando los pasos 1-4 ya se probaron en verde varias veces**: descomentar el bloque `schedule` de `.github/workflows/revision-diaria-seguimiento-produccion.yml` (`cron: "0 8-13 * * *"`, mismo horario que staging — 6 corridas, 08:00 a 13:00 UTC) en un commit aparte, y hacer push a `main` → `produccion` de nuevo.

## Qué NO hacer

- Nunca pegar una contraseña, un secreto o una URL de conexión completa en este documento, en un commit, ni en el chat — los pasos de arriba dicen DÓNDE conseguir o poner cada valor, nunca cuál es.
- Nunca activar el `schedule` del workflow de producción antes de confirmar manualmente que guarda fotos reales (paso 4) — un cron automático fallando en silencio por una variable mal puesta es peor que no tenerlo todavía.
- Nunca correr este checklist contra producción sin que staging ya lo tenga aplicado y funcionando (regla del repo: nada pasa a producción sin pasar antes por staging).
