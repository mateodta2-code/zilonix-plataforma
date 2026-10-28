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
  empresas, usuarios, roles, membresias, permisos_rol, invitaciones, accesos_temporales, cuentas_ml, avisos_ml,
  pedidos, publicaciones, importaciones_ml, skus, kit_componentes, pedido_eventos, despachos_ml, productos_ml,
  seguimientos_ml, seguimiento_fotos, seguimiento_alertas,
  titulares, configuracion_finanzas, metas_mensuales,
  publicidad_anunciantes, publicidad_campanas, publicidad_anuncios, publicidad_metricas_diarias, publicidad_costos_item, publicidad_sincronizaciones
  TO app_user;
-- Issue #127 (Z-FIN-05) — sin DELETE: un tercero se desactiva y una
-- fila de la tabla maestra se corrige, ninguno se borra. Son tablas
-- nuevas, así que no hay un DELETE viejo que revocar.
GRANT SELECT, INSERT, UPDATE ON terceros, costos_sku TO app_user;
-- Issue #125 (Z-FIN-03) — auditoria queda de solo inserción para
-- app_user: puede dejar el rastro y leer el de su empresa, no
-- reescribirlo ni borrarlo. REVOKE porque este script es repetible:
-- sacar la tabla de la lista de arriba no le quita un GRANT que ya
-- se había corrido en staging o producción. La pregunta 8 del
-- borrador (el issue la pone como condición) no aparece resuelta en
-- docs/ ni en los issues enlazados — en #124 "pregunta 8" es la de
-- los roles, ya contestada, y no habla de este GRANT. Se aplica igual
-- porque es criterio de aceptación de #125; queda pendiente de
-- confirmación de Sharel/Mateo.
GRANT SELECT, INSERT ON auditoria TO app_user;
REVOKE UPDATE, DELETE ON auditoria FROM app_user;
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

-- 1d) Issue #175 — cuarto usuario de base, mismo criterio que
-- trabajador_user (1c): la revisión diaria de seguimientos necesita
-- ver seguimientos_ml de CUALQUIER empresa (no sabe de antemano cuál
-- hasta leer la fila), pero nunca tiene que tocar cuentas_ml,
-- seguimiento_fotos ni seguimiento_alertas directamente — esas
-- escrituras de negocio pasan por dbComoEmpresa()/app_user una vez que
-- ya se sabe a qué empresa pertenece el seguimiento (mismo patrón
-- exacto que procesarUnAviso() en lib/ml/trabajador.ts, que tampoco usa
-- trabajador_user para nada más que avisos_ml).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'seguimiento_trabajador_user') THEN
    CREATE ROLE seguimiento_trabajador_user WITH LOGIN PASSWORD 'PONE_ACA_UNA_CUARTA_CONTRASEÑA_REAL';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO seguimiento_trabajador_user;
GRANT USAGE ON SCHEMA public TO seguimiento_trabajador_user;
-- Mínimo privilegio real: SELECT de la fila completa (necesita ver
-- tipo/recurso_ml/ml_id_externo para saber qué revisar), pero el único
-- UPDATE que de verdad hace falta es marcar ultima_revision_ts — un
-- GRANT de columna, no de la fila completa, para que ni un bug ni una
-- consulta armada a mano con esta conexión pueda tocar nombre,
-- es_competidor, eliminado_ts ni ninguna otra columna de negocio.
GRANT SELECT ON seguimientos_ml TO seguimiento_trabajador_user;
GRANT UPDATE (ultima_revision_ts) ON seguimientos_ml TO seguimiento_trabajador_user;

-- 1e) Issue #254 — quinto usuario de base. El nombre es exacto:
-- publicidad_trabajador_user. Lo crea Mateo a mano, después del merge,
-- al correr este script contra el Postgres del ambiente (el deploy no
-- lo crea). La contraseña la elige él al reemplazar el placeholder;
-- nunca queda en el repo. Después carga DATABASE_URL_PUBLICIDAD en
-- Railway. El cron de Product Ads
-- lista las cuentas conectadas de CUALQUIER empresa (no
-- sabe de antemano cuál) sin poder leer ni escribir tokens. El token
-- y todas las escrituras de publicidad pasan por dbComoEmpresa()/
-- app_user cuando ya se sabe la empresa. Las columnas del GRANT son
-- exactamente las que usa el SELECT de lib/trabajos/sincronizarPublicidad.ts
-- (id, empresa_id, desconectada_ts, creado_ts). La última sincronización
-- sale de publicidad_sincronizaciones, que sí se lee entera. Sumar una
-- columna de cuentas_ml a esa consulta sin sumarla acá hace fallar el
-- cron con permission denied.
-- publicidad_sincronizaciones sí se puede leer entera: es la bitácora
-- técnica (estado, rango, texto corto de error). Nunca trae el token.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'publicidad_trabajador_user') THEN
    CREATE ROLE publicidad_trabajador_user WITH LOGIN PASSWORD 'PONE_ACA_UNA_QUINTA_CONTRASEÑA_REAL';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO publicidad_trabajador_user;
GRANT USAGE ON SCHEMA public TO publicidad_trabajador_user;
GRANT SELECT (id, empresa_id, desconectada_ts, creado_ts) ON cuentas_ml TO publicidad_trabajador_user;
GRANT SELECT ON publicidad_sincronizaciones TO publicidad_trabajador_user;

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
-- Issue #125 — mismas tres tablas nuevas. Sin FORCE, el dueño de la
-- tabla se salta la política igual que un superusuario.
ALTER TABLE titulares ENABLE ROW LEVEL SECURITY;
ALTER TABLE titulares FORCE ROW LEVEL SECURITY;
ALTER TABLE configuracion_finanzas ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_finanzas FORCE ROW LEVEL SECURITY;
ALTER TABLE metas_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas_mensuales FORCE ROW LEVEL SECURITY;
-- Issue #127.
ALTER TABLE terceros ENABLE ROW LEVEL SECURITY;
ALTER TABLE terceros FORCE ROW LEVEL SECURITY;
ALTER TABLE costos_sku ENABLE ROW LEVEL SECURITY;
ALTER TABLE costos_sku FORCE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales FORCE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE avisos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE avisos_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos FORCE ROW LEVEL SECURITY;
ALTER TABLE publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicaciones FORCE ROW LEVEL SECURITY;
ALTER TABLE importaciones_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE importaciones_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus FORCE ROW LEVEL SECURITY;
ALTER TABLE kit_componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_componentes FORCE ROW LEVEL SECURITY;
ALTER TABLE pedido_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_eventos FORCE ROW LEVEL SECURITY;
ALTER TABLE despachos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE productos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimientos_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimientos_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_fotos FORCE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_alertas FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_anunciantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_anunciantes FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_campanas FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_anuncios ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_anuncios FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_metricas_diarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_metricas_diarias FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_costos_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_costos_item FORCE ROW LEVEL SECURITY;
ALTER TABLE publicidad_sincronizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_sincronizaciones FORCE ROW LEVEL SECURITY;

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

-- Issue #181 — la pantalla de confirmación de transferencia necesita
-- mostrar el NOMBRE de la empresa que hoy tiene la cuenta de Mercado
-- Libre ("ya está conectada a la empresa «sawii»"), antes de que quien
-- confirma sea parte de esa empresa. El subselect sobre cuentas_ml
-- queda sujeto, a su vez, a la política cuentas_ml_por_transferencia_leer
-- de arriba (misma variable de sesión) — nunca expone más que la fila
-- puntual que el propio OAuth ya confirmó.
DROP POLICY IF EXISTS empresas_por_transferencia_cuenta_ml ON empresas;
CREATE POLICY empresas_por_transferencia_cuenta_ml ON empresas FOR SELECT
  USING (
    id IN (
      SELECT empresa_id FROM cuentas_ml
      WHERE cuenta_id_externa = current_setting('app.cuenta_ml_transferencia_actual', true)
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

-- Issue #125 — mismo patrón que el resto de las tablas de negocio.
DROP POLICY IF EXISTS aislamiento_titulares ON titulares;
CREATE POLICY aislamiento_titulares ON titulares
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_configuracion_finanzas ON configuracion_finanzas;
CREATE POLICY aislamiento_configuracion_finanzas ON configuracion_finanzas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_metas_mensuales ON metas_mensuales;
CREATE POLICY aislamiento_metas_mensuales ON metas_mensuales
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Issue #127 — mismo patrón: una empresa nunca ve ni toca los
-- proveedores ni la tabla maestra de otra.
DROP POLICY IF EXISTS aislamiento_terceros ON terceros;
CREATE POLICY aislamiento_terceros ON terceros
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_costos_sku ON costos_sku;
CREATE POLICY aislamiento_costos_sku ON costos_sku
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

-- Issue #181 — transferir una cuenta ya conectada en OTRA empresa:
-- política APARTE de la de aviso_webhook (trust boundary distinto —
-- este camino sí exige sesión real + requierePermiso('configuracion',
-- 'crear'), un webhook no tiene ninguno de los dos), con su propia
-- variable de sesión (dbComoTransferenciaCuentaMl, db/empresa-context.ts).
-- Mismo principio que siempre: el cuenta_id_externa puntual (que
-- Mercado Libre ya confirmó real en el propio OAuth) ES el permiso
-- para ver/actualizar esa fila nada más, nunca las de otra cuenta.
-- FOR UPDATE sin WITH CHECK explícito: cuenta_id_externa nunca cambia
-- en la transferencia (solo empresa_id, tokens, nickname), así que la
-- fila nueva sigue cumpliendo el mismo USING — comportamiento estándar
-- de Postgres (sin WITH CHECK, se reusa el USING también para la fila
-- resultante).
DROP POLICY IF EXISTS cuentas_ml_por_transferencia_leer ON cuentas_ml;
CREATE POLICY cuentas_ml_por_transferencia_leer ON cuentas_ml FOR SELECT
  USING (cuenta_id_externa = current_setting('app.cuenta_ml_transferencia_actual', true));
DROP POLICY IF EXISTS cuentas_ml_por_transferencia_actualizar ON cuentas_ml;
CREATE POLICY cuentas_ml_por_transferencia_actualizar ON cuentas_ml FOR UPDATE
  USING (cuenta_id_externa = current_setting('app.cuenta_ml_transferencia_actual', true));

DROP POLICY IF EXISTS aislamiento_avisos_ml ON avisos_ml;
CREATE POLICY aislamiento_avisos_ml ON avisos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_pedidos ON pedidos;
CREATE POLICY aislamiento_pedidos ON pedidos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicaciones ON publicaciones;
CREATE POLICY aislamiento_publicaciones ON publicaciones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_importaciones_ml ON importaciones_ml;
CREATE POLICY aislamiento_importaciones_ml ON importaciones_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_skus ON skus;
CREATE POLICY aislamiento_skus ON skus
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_kit_componentes ON kit_componentes;
CREATE POLICY aislamiento_kit_componentes ON kit_componentes
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_pedido_eventos ON pedido_eventos;
CREATE POLICY aislamiento_pedido_eventos ON pedido_eventos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_despachos_ml ON despachos_ml;
CREATE POLICY aislamiento_despachos_ml ON despachos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_productos_ml ON productos_ml;
CREATE POLICY aislamiento_productos_ml ON productos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Issue #175 — mismo patrón de siempre: tráfico normal de app_user,
-- nunca ve ni toca el seguimiento/foto/alerta de otra empresa.
DROP POLICY IF EXISTS aislamiento_seguimientos_ml ON seguimientos_ml;
CREATE POLICY aislamiento_seguimientos_ml ON seguimientos_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_seguimiento_fotos ON seguimiento_fotos;
CREATE POLICY aislamiento_seguimiento_fotos ON seguimiento_fotos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_seguimiento_alertas ON seguimiento_alertas;
CREATE POLICY aislamiento_seguimiento_alertas ON seguimiento_alertas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Issue #175 — política APARTE, con TO seguimiento_trabajador_user:
-- la revisión diaria ve y marca ultima_revision_ts de CUALQUIER
-- seguimiento, de cualquier empresa (mismo criterio que
-- trabajador_procesa_avisos_ml más arriba) — nunca ninguna otra
-- tabla (ver GRANT, solo seguimientos_ml). No reemplaza la política de
-- arriba, que sigue aplicando igual al tráfico normal de app_user.
DROP POLICY IF EXISTS seguimiento_trabajador_lee_seguimientos_ml ON seguimientos_ml;
CREATE POLICY seguimiento_trabajador_lee_seguimientos_ml ON seguimientos_ml FOR SELECT TO seguimiento_trabajador_user USING (true);
DROP POLICY IF EXISTS seguimiento_trabajador_marca_revision_seguimientos_ml ON seguimientos_ml;
CREATE POLICY seguimiento_trabajador_marca_revision_seguimientos_ml ON seguimientos_ml FOR UPDATE TO seguimiento_trabajador_user USING (true);

-- Issue #254 — app_user solo ve la publicidad de la empresa activa.
DROP POLICY IF EXISTS aislamiento_publicidad_anunciantes ON publicidad_anunciantes;
CREATE POLICY aislamiento_publicidad_anunciantes ON publicidad_anunciantes
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicidad_campanas ON publicidad_campanas;
CREATE POLICY aislamiento_publicidad_campanas ON publicidad_campanas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicidad_anuncios ON publicidad_anuncios;
CREATE POLICY aislamiento_publicidad_anuncios ON publicidad_anuncios
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicidad_metricas_diarias ON publicidad_metricas_diarias;
CREATE POLICY aislamiento_publicidad_metricas_diarias ON publicidad_metricas_diarias
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicidad_costos_item ON publicidad_costos_item;
CREATE POLICY aislamiento_publicidad_costos_item ON publicidad_costos_item
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_publicidad_sincronizaciones ON publicidad_sincronizaciones;
CREATE POLICY aislamiento_publicidad_sincronizaciones ON publicidad_sincronizaciones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- El cron lista cuentas y la bitácora de cualquier empresa. No
-- reemplaza el aislamiento de app_user: el TO limita estas políticas
-- a publicidad_trabajador_user.
DROP POLICY IF EXISTS publicidad_trabajador_lee_cuentas_ml ON cuentas_ml;
CREATE POLICY publicidad_trabajador_lee_cuentas_ml ON cuentas_ml FOR SELECT TO publicidad_trabajador_user USING (true);
DROP POLICY IF EXISTS publicidad_trabajador_lee_sincronizaciones ON publicidad_sincronizaciones;
CREATE POLICY publicidad_trabajador_lee_sincronizaciones ON publicidad_sincronizaciones FOR SELECT TO publicidad_trabajador_user USING (true);

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
