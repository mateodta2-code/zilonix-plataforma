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

### 2.1 Migración `0009` (seguimientos_ml/seguimiento_fotos/seguimiento_alertas), si falta

Primero confirmar si ya está aplicada:
```sql
SELECT to_regclass('public.seguimientos_ml');
```
Si devuelve `NULL`, falta — correr la migración:
```
DATABASE_URL="<la-url-del-túnel>" npm run db:migrate
```
(Drizzle aplica solo lo que falte — si `0009` ya corrió antes, no hace nada y no rompe nada.)

Si devuelve algo distinto de `NULL` (la tabla ya existe), seguir directo al punto 2.2.

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

## 2.5 Problema real encontrado en vivo: "Application error" al hacer "Seguir en Zilonix" en producción (issue #207, follow-up)

Síntoma real: agregar un seguimiento en producción (desde la extensión o desde el formulario) termina en la pantalla genérica de Next.js ("Application error", con un número de digest tipo `2846050239`) en vez del aviso normal. Causa real confirmada: la contraseña que Postgres tiene puesta para el rol `seguimiento_trabajador_user` NO coincide con la que está codificada en la URL de la variable `DATABASE_URL_SEGUIMIENTO` de Railway (producción) — Postgres rechaza la conexión, `db/trabajador-seguimiento-context.ts` nunca llega a conectar, y esa excepción sin capturar es justo lo que Next.js muestra como "Application error" sin detalle (por diseño — nunca el stack real a quien no tiene sesión de servidor). Los HOSTS de las `DATABASE_URL_*` ya estaban corregidos a `postgres.railway.internal` antes de este diagnóstico — eso no es el problema, es la contraseña.

**Paso 1 — confirmar qué existe de verdad, sin pegar ningún valor real** (mismo túnel + `psql` real de arriba):
```sql
-- Tablas (ninguna debería dar NULL si la migración ya corrió)
SELECT to_regclass('public.seguimientos_ml'), to_regclass('public.seguimiento_fotos'), to_regclass('public.seguimiento_alertas');

-- Rol: tiene que existir, con Login, sin Superuser/Createrole
\du seguimiento_trabajador_user

-- Las 5 políticas de siempre
SELECT polname FROM pg_policies WHERE tablename LIKE 'seguimiento%';

-- GRANTs reales del rol — tiene que ser SELECT de la fila completa en
-- seguimientos_ml, y UPDATE solo de la columna ultima_revision_ts
-- (nunca de la fila completa)
SELECT table_name, privilege_type FROM information_schema.table_privileges WHERE grantee = 'seguimiento_trabajador_user';
SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE grantee = 'seguimiento_trabajador_user';
```
Si CUALQUIERA de estos cuatro chequeos no da lo esperado, resolverlo con el bloque de la sección 2.2 (es idempotente, se puede repetir) antes de seguir al paso 2.

**Paso 2 — sincronizar la contraseña del rol con la de `DATABASE_URL_SEGUIMIENTO`** (la variable de Railway es la fuente real — el rol tiene que quedar igual a ella, nunca al revés, porque la app ya está desplegada leyendo esa variable):
1. Copiar (nunca escribir de memoria) la contraseña que YA está puesta en el valor de `DATABASE_URL_SEGUIMIENTO` en Railway (producción) — la parte entre `seguimiento_trabajador_user:` y `@` en la URL.
2. Conectarse a Postgres con un usuario que pueda hacer `ALTER ROLE` (el superusuario de `DATABASE_URL`, nunca `app_user` ni ningún rol restringido) — dos formas, usar la que de verdad funcione con el plan de Railway:
   - Si el servicio de Postgres admite `railway ssh` (shell directo al contenedor): `railway ssh --service <postgres-prod> --environment production`, y desde ahí `psql $DATABASE_URL` (la variable del superusuario ya vive en ese entorno).
   - Si no, el túnel de siempre: `railway connect <postgres-prod> --environment production --tunnel-only`, y conectarse con `psql` local a la URL que imprime.
3. Ya conectado, pegar (solo ahí, nunca en otro lado):
   ```sql
   ALTER ROLE seguimiento_trabajador_user WITH PASSWORD 'LA-CONTRASEÑA-QUE-COPIASTE-EN-EL-PASO-1';
   ```
   Postgres la guarda cifrada (SCRAM-SHA-256, el default actual) — nunca en texto plano, no hace falta ningún paso extra.
4. Nunca hace falta reiniciar el servicio `web` a mano para esto — es un cambio solo del lado de Postgres, la próxima conexión del pool ya usa la contraseña nueva.

**Criterio de éxito real**: agregar un seguimiento en producción (formulario o extensión) deja de dar "Application error" — termina en el aviso normal (agregado, ya existía, o un error de Mercado Libre con mensaje claro, nunca la pantalla genérica). Opcional, más contundente: una corrida manual del workflow (sección 4) deja al menos una fila nueva en `seguimiento_fotos` con la fecha de hoy.

## 3. Variables y secretos

- `DATABASE_URL_SEGUIMIENTO` y `SEGUIMIENTO_TRABAJADOR_SECRET` (variable de Railway, producción) — deberían existir ya; si no, armarlas ahora (ver punto 2.3 para la primera; la segunda es un secreto compartido nuevo, cualquier cadena larga y aleatoria).
- **GitHub → Settings → Secrets and variables → Actions**: crear `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION` con el MISMO valor que `SEGUIMIENTO_TRABAJADOR_SECRET` tiene en Railway producción (copiar el valor de Railway a GitHub, nunca inventar uno distinto — si no coinciden, el workflow va a dar 401).

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
