-- Tarea 1.3 — seguridad por fila (RLS). Script REPETIBLE, corrido a
-- mano (no es una migración de Drizzle) porque crea un usuario de base
-- de datos con contraseña — un secreto que nunca debe quedar en un
-- archivo versionado en git. Se puede volver a correr completo sin
-- romper nada si ya se corrió antes (tarea 1.6: así es como se trae una
-- base ya armada al día con una política nueva, sin tener que acordarse
-- de borrar a mano la política vieja).
--
-- Cómo correrlo: con el túnel privado abierto (railway connect Postgres
-- --tunnel-only), conectarse con psql a la URL que imprime el túnel y
-- pegar este script completo, DESPUÉS de reemplazar
-- 'PONE_ACA_UNA_CONTRASEÑA_REAL' y 'PONE_ACA_OTRA_CONTRASEÑA_REAL' (tarea
-- 1.11, abajo) por contraseñas reales, DISTINTAS entre sí, elegidas por
-- quien lo corre (nunca por Claude Code). Si el usuario ya existe (porque
-- ya se corrió antes), esa contraseña nueva no se usa para nada — se
-- salta la creación y sigue derecho con los permisos y las políticas.

-- 1) Usuario de base de datos restringido — el que usa la app para
-- TODO el tráfico normal (no el superusuario que da Railway en
-- DATABASE_URL, que puede saltarse cualquier política de RLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'PONE_ACA_UNA_CONTRASEÑA_REAL';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  empresas, usuarios, roles, membresias, permisos_rol, invitaciones, auditoria, accesos_temporales, cuentas_ml, avisos_ml
  TO app_user;
-- No hay GRANT de secuencias a propósito: todas las tablas usan uuid()
-- con defaultRandom() como llave primaria, no hay ninguna columna
-- "serial" en el esquema — no existe ninguna secuencia que otorgar.

-- 1b) Tarea 1.11 (decisión D8) — segundo usuario de base, aparte y más
-- limitado: el panel superadmin NUNCA se conecta con app_user. Solo
-- lectura de lo agregado (nunca INSERT/UPDATE/DELETE de datos de una
-- empresa) + permiso de ESCRIBIR su propio rastro en auditoria (nunca
-- de leerlo de vuelta — ver detalle con permiso queda registrado, pero
-- el superadmin no puede revisar ni borrar ese registro él mismo).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'superadmin_user') THEN
    CREATE ROLE superadmin_user WITH LOGIN PASSWORD 'PONE_ACA_OTRA_CONTRASEÑA_REAL';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO superadmin_user;
GRANT USAGE ON SCHEMA public TO superadmin_user;
GRANT SELECT ON empresas, membresias, roles, usuarios, accesos_temporales TO superadmin_user;
GRANT INSERT ON auditoria TO superadmin_user;

-- 1c) Tarea 2.4 — tercer usuario de base, el más limitado de los tres:
-- el trabajador de cola necesita ver avisos de CUALQUIER empresa (no
-- sabe de antemano cuál hasta leer la fila) y marcarlos procesados,
-- pero nunca tiene que tocar ninguna otra tabla de negocio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trabajador_user') THEN
    CREATE ROLE trabajador_user WITH LOGIN PASSWORD 'PONE_ACA_UNA_TERCERA_CONTRASEÑA_REAL';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO trabajador_user;
GRANT USAGE ON SCHEMA public TO trabajador_user;
GRANT SELECT, UPDATE ON avisos_ml TO trabajador_user;

-- 2) Seguridad por fila — se activa por tabla, y se FUERZA también para
-- el dueño de la tabla (sin el FORCE, el dueño de la tabla se salta la
-- política igual que un superusuario, que es justo el agujero que
-- queremos cerrar).
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE membresias ENABLE ROW LEVEL SECURITY;
ALTER TABLE membresias FORCE ROW LEVEL SECURITY;
ALTER TABLE permisos_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos_rol FORCE ROW LEVEL SECURITY;
ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales FORCE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE avisos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE avisos_ml FORCE ROW LEVEL SECURITY;

-- La tabla "usuarios" NO lleva RLS por empresa: una persona puede estar
-- en varias empresas (decisión D2), así que no tiene una sola
-- "empresa dueña". No guarda datos de negocio, solo identidad
-- (email, nombre, vínculo con Clerk) — queda fuera del alcance de esta
-- tarea a propósito.

-- 3) Las políticas en sí. Todas comparan contra una variable de sesión
-- (app.empresa_actual) que la app fija al principio de cada petición
-- con el helper db/empresa-context.ts — si nadie la fija, la comparación
-- falla sola y no se ve ninguna fila (cerrado por defecto).
--
-- DROP POLICY IF EXISTS antes de cada CREATE: para que este script se
-- pueda volver a correr completo cuando una política cambia (como acá
-- abajo, en la tarea 1.6) sin tener que editar a mano la base real
-- primero.

DROP POLICY IF EXISTS aislamiento_empresas ON empresas;
CREATE POLICY aislamiento_empresas ON empresas
  USING (
    id = current_setting('app.empresa_actual', true)::uuid
    -- Tarea 1.6: además de la empresa activa, un usuario siempre ve las
    -- empresas donde tiene membresía — lo necesita el selector de
    -- cambio de empresa para listarlas ANTES de elegir cuál activar.
    -- No es una fuga entre empresas: cada quien solo ve su PROPIA lista
    -- de membresías (política de membresias, debajo), nunca la de otra
    -- persona. NULLIF(...,'') en vez del cast directo: a propósito NO
    -- revienta cuando nadie fijó un usuario (el tráfico normal, que
    -- solo fija empresa_actual) — simplemente no aporta ninguna fila
    -- extra, y la primera mitad de este OR sigue intacta tal cual la
    -- probó la tarea 1.4.
    OR id IN (
      SELECT empresa_id FROM membresias
      WHERE usuario_id = NULLIF(current_setting('app.usuario_actual', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS aislamiento_roles ON roles;
CREATE POLICY aislamiento_roles ON roles
  -- empresa_id vacío = plantilla de fábrica, visible para cualquier
  -- empresa (nunca editable por ellas, eso lo controla la capa de
  -- permisos, no esta política).
  USING (empresa_id IS NULL OR empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_membresias ON membresias;
CREATE POLICY aislamiento_membresias ON membresias
  USING (
    empresa_id = current_setting('app.empresa_actual', true)::uuid
    -- Tarea 1.6: un usuario siempre ve sus PROPIAS membresías (en
    -- cualquier empresa) — nunca la membresía de otra persona, salvo
    -- que además coincida con la empresa activa (primera mitad del OR,
    -- sin cambios). Mismo NULLIF que arriba, mismo motivo.
    OR usuario_id = NULLIF(current_setting('app.usuario_actual', true), '')::uuid
  );

DROP POLICY IF EXISTS aislamiento_permisos_rol ON permisos_rol;
CREATE POLICY aislamiento_permisos_rol ON permisos_rol
  -- permisos_rol no tiene empresa_id propio — se resuelve mirando el
  -- rol al que pertenece.
  USING (
    rol_id IN (
      SELECT id FROM roles
      WHERE empresa_id IS NULL OR empresa_id = current_setting('app.empresa_actual', true)::uuid
    )
  );

DROP POLICY IF EXISTS aislamiento_invitaciones ON invitaciones;
CREATE POLICY aislamiento_invitaciones ON invitaciones
  USING (
    empresa_id = current_setting('app.empresa_actual', true)::uuid
    -- Tarea 1.7: quien tiene el token de una invitación puede ver y
    -- aceptar esa fila puntual, sin ser todavía miembro de la empresa
    -- (dbComoInvitacion(), db/empresa-context.ts). `token` es texto, no
    -- uuid — a diferencia de la mitad "usuario_actual" de empresas/
    -- membresias (tarea 1.6), acá NO hace falta NULLIF: comparar contra
    -- '' (lo que devuelve current_setting cuando nadie fijó el token)
    -- nunca revienta, solo da falso, porque nunca es un cast a uuid.
    OR token = current_setting('app.invitacion_token_actual', true)
  );

DROP POLICY IF EXISTS aislamiento_auditoria ON auditoria;
CREATE POLICY aislamiento_auditoria ON auditoria
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_accesos_temporales ON accesos_temporales;
CREATE POLICY aislamiento_accesos_temporales ON accesos_temporales
  -- Tráfico normal (app_user, Dueño gestionando sus propios accesos
  -- concedidos): mismo patrón que toda tabla de negocio.
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_cuentas_ml ON cuentas_ml;
CREATE POLICY aislamiento_cuentas_ml ON cuentas_ml
  -- Tarea 2.3 — mismo patrón de siempre, nada especial: una empresa
  -- nunca ve ni toca la cuenta de Mercado Libre de otra.
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Tarea 2.4 — un aviso de Mercado Libre llega con el user_id de la
-- cuenta, sin decir a qué empresa de Zilonix pertenece. Política APARTE
-- (FOR SELECT nada más — un webhook nunca debe poder escribir ni
-- borrar cuentas_ml), que expone UNA sola fila: la que coincide con el
-- user_id que mandó Mercado Libre, sin importar de qué empresa sea.
-- Mismo principio que la política de invitaciones por token (tarea
-- 1.7): el dato puntual correcto ES el permiso para verlo, no hace
-- falta ya ser parte de esa empresa.
DROP POLICY IF EXISTS cuentas_ml_por_aviso_webhook ON cuentas_ml;
CREATE POLICY cuentas_ml_por_aviso_webhook ON cuentas_ml FOR SELECT
  USING (cuenta_id_externa = current_setting('app.cuenta_ml_externa_actual', true));

DROP POLICY IF EXISTS aislamiento_avisos_ml ON avisos_ml;
CREATE POLICY aislamiento_avisos_ml ON avisos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Tarea 2.4 — política APARTE, con TO trabajador_user: el trabajador de
-- cola ve y marca procesado cualquier aviso pendiente, de cualquier
-- empresa — nunca ninguna otra tabla (ver GRANT más arriba, solo
-- avisos_ml). No reemplaza la política de arriba, que sigue aplicando
-- igual al tráfico normal de app_user.
DROP POLICY IF EXISTS trabajador_procesa_avisos_ml ON avisos_ml;
CREATE POLICY trabajador_procesa_avisos_ml ON avisos_ml FOR SELECT TO trabajador_user USING (true);
DROP POLICY IF EXISTS trabajador_marca_procesado_avisos_ml ON avisos_ml;
CREATE POLICY trabajador_marca_procesado_avisos_ml ON avisos_ml FOR UPDATE TO trabajador_user USING (true);

-- 4) Tarea 1.11 (decisión D8) — políticas de superadmin_user. Son
-- políticas APARTE, con TO superadmin_user: no reemplazan ni debilitan
-- ninguna de arriba (esas siguen aplicando igual a app_user, que nunca
-- las cumple si se conecta como superadmin_user por error, porque
-- jamás fija app.empresa_actual). Con RLS, dos políticas permisivas se
-- combinan con OR — por eso alcanza con agregar la de superadmin_user
-- sin tocar la de app_user.
--
-- A propósito, solo SELECT y solo sobre lo que ya es agregado o es
-- metadato de permiso (no hay ninguna tabla de "comprador final"
-- todavía — llega en Fase 2; cuando llegue, esa tabla NO entra en esta
-- lista hasta que se decida cómo aplica el acceso temporal sobre ella).
DROP POLICY IF EXISTS superadmin_ve_empresas ON empresas;
CREATE POLICY superadmin_ve_empresas ON empresas FOR SELECT TO superadmin_user USING (true);

DROP POLICY IF EXISTS superadmin_ve_membresias ON membresias;
CREATE POLICY superadmin_ve_membresias ON membresias FOR SELECT TO superadmin_user USING (true);

DROP POLICY IF EXISTS superadmin_ve_roles ON roles;
CREATE POLICY superadmin_ve_roles ON roles FOR SELECT TO superadmin_user USING (true);

DROP POLICY IF EXISTS superadmin_ve_accesos_temporales ON accesos_temporales;
CREATE POLICY superadmin_ve_accesos_temporales ON accesos_temporales FOR SELECT TO superadmin_user USING (true);

-- El detalle de quién trabaja en una empresa (usuarios.nombre/email)
-- SÍ exige el acceso temporal de la empresa — pero ese candado vive en
-- la aplicación (lib/superadmin.ts, requiereAccesoTemporal()), no
-- acá: `usuarios` nunca tuvo RLS (tarea 1.3, puede estar en varias
-- empresas) y no le vamos a agregar ahora solo para esto. El límite
-- real que SÍ pone la base es que superadmin_user nunca puede
-- escribir nada de negocio (solo tiene SELECT, nunca INSERT/UPDATE/
-- DELETE en ninguna tabla de empresas) y que cada vista de detalle
-- queda escrita en auditoria sin que superadmin_user pueda editarla
-- ni borrarla después.
DROP POLICY IF EXISTS superadmin_escribe_auditoria ON auditoria;
CREATE POLICY superadmin_escribe_auditoria ON auditoria FOR INSERT TO superadmin_user WITH CHECK (true);
