-- Tarea 1.3 — seguridad por fila (RLS). Script de UNA SOLA VEZ, corrido a
-- mano (no es una migración de Drizzle) porque crea un usuario de base
-- de datos con contraseña — un secreto que nunca debe quedar en un
-- archivo versionado en git.
--
-- Cómo correrlo: con el túnel privado abierto (railway connect Postgres
-- --tunnel-only), conectarse con psql a la URL que imprime el túnel y
-- pegar este script completo, DESPUÉS de reemplazar
-- 'PONE_ACA_UNA_CONTRASEÑA_REAL' por una contraseña real, elegida por
-- quien lo corre (nunca por Claude Code).

-- 1) Usuario de base de datos restringido — el que usa la app para
-- TODO el tráfico normal (no el superusuario que da Railway en
-- DATABASE_URL, que puede saltarse cualquier política de RLS).
CREATE ROLE app_user WITH LOGIN PASSWORD 'PONE_ACA_UNA_CONTRASEÑA_REAL';
GRANT CONNECT ON DATABASE railway TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  empresas, usuarios, roles, membresias, permisos_rol, invitaciones, auditoria
  TO app_user;
-- No hay GRANT de secuencias a propósito: todas las tablas usan uuid()
-- con defaultRandom() como llave primaria, no hay ninguna columna
-- "serial" en el esquema — no existe ninguna secuencia que otorgar.

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

-- La tabla "usuarios" NO lleva RLS por empresa: una persona puede estar
-- en varias empresas (decisión D2), así que no tiene una sola
-- "empresa dueña". No guarda datos de negocio, solo identidad
-- (email, nombre, vínculo con Clerk) — queda fuera del alcance de esta
-- tarea a propósito.

-- 3) Las políticas en sí. Todas comparan contra una variable de sesión
-- (app.empresa_actual) que la app fija al principio de cada petición
-- con el helper db/empresa-context.ts — si nadie la fija, la comparación
-- falla sola y no se ve ninguna fila (cerrado por defecto).

CREATE POLICY aislamiento_empresas ON empresas
  USING (id = current_setting('app.empresa_actual', true)::uuid);

CREATE POLICY aislamiento_roles ON roles
  -- empresa_id vacío = plantilla de fábrica, visible para cualquier
  -- empresa (nunca editable por ellas, eso lo controla la capa de
  -- permisos, no esta política).
  USING (empresa_id IS NULL OR empresa_id = current_setting('app.empresa_actual', true)::uuid);

CREATE POLICY aislamiento_membresias ON membresias
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

CREATE POLICY aislamiento_permisos_rol ON permisos_rol
  -- permisos_rol no tiene empresa_id propio — se resuelve mirando el
  -- rol al que pertenece.
  USING (
    rol_id IN (
      SELECT id FROM roles
      WHERE empresa_id IS NULL OR empresa_id = current_setting('app.empresa_actual', true)::uuid
    )
  );

CREATE POLICY aislamiento_invitaciones ON invitaciones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

CREATE POLICY aislamiento_auditoria ON auditoria
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Nota real (decisión D8, 14/10/2026): el acceso del superadmin a las
-- cifras agregadas de negocio (facturación, zona de venta) de CUALQUIER
-- empresa NO se resuelve acá — esta tarea (1.3) solo aísla una empresa
-- de otra para el tráfico normal de la app. El acceso de superadmin usa
-- su propio rol de base de datos, separado, con sus propias políticas
-- más permisivas sobre tablas agregadas — eso es la tarea 1.11, todavía
-- no construida.
