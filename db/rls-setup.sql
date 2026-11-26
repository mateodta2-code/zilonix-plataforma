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
  cuentas_falabella, pedidos_falabella,
  -- Issue #422 (Bloque 1) — conector OAuth de Mercado Pago.
  cuentas_mp,
  pedidos, publicaciones, importaciones_ml, skus, kit_componentes, pedido_eventos, despachos_ml, productos_ml,
  seguimientos_ml, seguimiento_fotos, seguimiento_alertas,
  titulares, configuracion_finanzas, metas_mensuales,
  publicidad_anunciantes, publicidad_campanas, publicidad_anuncios, publicidad_metricas_diarias, publicidad_costos_item, publicidad_sincronizaciones,
  publicidad_campanas_cambios
  TO app_user;
-- Issue #127 (Z-FIN-05) — sin DELETE: un tercero se desactiva y una
-- fila de la tabla maestra se corrige, ninguno se borra. Son tablas
-- nuevas, así que no hay un DELETE viejo que revocar.
GRANT SELECT, INSERT, UPDATE ON terceros, costos_sku TO app_user;
-- Issue #422 (fase 6, Disponible) — sin DELETE: una cuenta solo se
-- desactiva (UPDATE de activa, nada más) y un saldo nunca se edita ni
-- se borra; corregir es registrar otro con su fecha de corte.
GRANT SELECT, INSERT ON cuentas_disponible, saldos_disponible TO app_user;
GRANT UPDATE (activa) ON cuentas_disponible TO app_user;
-- Issue #129 (Z-FIN-07) — ventas: sin DELETE. La cabecera y las
-- líneas solo se borran en cascada con su pedido. Una corrección no se
-- edita ni se borra: el único UPDATE permitido es anularla
-- (anulada_ts), y la política de abajo no deja des-anularla.
GRANT SELECT, INSERT, UPDATE ON pedidos_finanzas, pedido_items TO app_user;
GRANT SELECT, INSERT ON ventas_correcciones TO app_user;
GRANT UPDATE (anulada_ts) ON ventas_correcciones TO app_user;
-- Issue #280 (WMS Fase 1) — nada de inventario se borra: una bodega se
-- desactiva, un saldo cambia solo por un movimiento y el kardex es de
-- solo inserción (ni UPDATE ni DELETE: la historia no se reescribe).
-- Una recepción tampoco se edita: si llegó mal, se corrige con un
-- ajuste, que queda en el kardex.
GRANT SELECT, INSERT, UPDATE ON bodegas, stock_bodega, ordenes_compra, orden_compra_items,
  configuracion_inventario, sync_stock_ml, alertas_ultima_unidad TO app_user;
GRANT SELECT, INSERT ON kardex_movimientos, recepciones, recepcion_items TO app_user;
REVOKE UPDATE, DELETE ON kardex_movimientos, recepciones, recepcion_items FROM app_user;
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
-- Rama feat-promociones — promociones_candidatos es un snapshot que se
-- UPSERTea (nunca se borra fila por fila, siempre ON CONFLICT DO
-- UPDATE); promociones_acciones es historial/auditoría, solo se agrega
-- y se actualiza su propio estado, nunca se borra. ia_conexiones sí
-- necesita DELETE real: desconectar la IA de una empresa es una acción
-- legítima de un clic, sin ningún motivo para guardar la fila vieja.
GRANT SELECT, INSERT, UPDATE ON promociones_reglas, promociones_candidatos, promociones_acciones TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ia_conexiones TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ia_conexion_modulos TO app_user;
-- Publicar → «Crear con IA» (PR2): historial de imágenes por empresa.
-- Sin DELETE: el historial no se borra (decisión de la tarea, aprobada
-- por Mateo el 19-nov-2026).
GRANT SELECT, INSERT, UPDATE ON publicaciones_ia_trabajos TO app_user;
GRANT SELECT, INSERT, UPDATE ON publicaciones_ia_imagenes TO app_user;
-- Optimización → bitácora (migración 0035, aprobada por Mateo): notas a
-- mano y revisión de cada cambio. Sin DELETE: es un historial.
GRANT SELECT, INSERT, UPDATE ON optimizacion_notas TO app_user;
GRANT SELECT, INSERT, UPDATE ON optimizacion_revisiones TO app_user;
-- Issue #422 (fase 4 de Finanzas, migraciones 0037-0038) — gastos
-- externos y sus categorías. Sin DELETE: una categoría se desactiva y un
-- gasto se corrige editándolo (cada cambio queda en auditoria).
GRANT SELECT, INSERT, UPDATE ON categorias_gasto, gastos TO app_user;
-- Tarea "Publicar — conectar Canva" — a diferencia de ia_conexiones,
-- desconectar Canva NUNCA borra la fila (decisión explícita de
-- Pablo/Mateo: queda desconectada_ts como histórico, los tokens se
-- limpian con UPDATE, no con DELETE) — por eso sin DELETE acá.
GRANT SELECT, INSERT, UPDATE ON canva_conexiones TO app_user;
-- Issue #422 (conciliación Falabella) — los movimientos del reporte de
-- transacciones se UPSERTean al reimportar (solo cambian estado de pago
-- y estado de cuenta) y nunca se borran: sin DELETE.
GRANT SELECT, INSERT, UPDATE ON movimientos_marketplace TO app_user;
-- Foro de la comunidad (14-nov) — compartido entre TODAS las empresas
-- por diseño (sin empresa_id ni política por empresa, igual que
-- usuarios). Desde /panel solo se lee y se publica: nadie edita ni
-- borra lo de otro, ni lo propio. REVOKE porque el script es repetible.
GRANT SELECT, INSERT ON foro_preguntas, foro_respuestas TO app_user;
REVOKE UPDATE, DELETE ON foro_preguntas, foro_respuestas FROM app_user;
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
-- PR B (Empresas y planes) — plan/estado/suspensión/notas son de Zilonix,
-- no de la empresa: UPDATE por columna, solo para superadmin_user. app_user
-- conserva UPDATE únicamente sobre nombre y nit (REVOKE de tabla primero:
-- un REVOKE por columna no le quita un GRANT que se dio sobre la tabla
-- entera). Script repetible: ambos pasos son idempotentes.
REVOKE UPDATE ON empresas FROM app_user;
GRANT UPDATE (nombre, nit) ON empresas TO app_user;
GRANT UPDATE (plan, estado, suspendida_motivo, suspendida_ts, notas_internas) ON empresas TO superadmin_user;
-- Foro (14-nov) — moderar es esconder, nunca borrar ni reescribir: el
-- superadmin solo puede marcar oculta_ts/oculta_por. El foro no es
-- dato de negocio de ninguna empresa, así que verlo no rompe D8.
GRANT SELECT ON foro_preguntas, foro_respuestas TO superadmin_user;
GRANT UPDATE (oculta_ts, oculta_por) ON foro_preguntas, foro_respuestas TO superadmin_user;

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

-- 1f) Issue #422 — sexto usuario de base: falabella_trabajador_user.
-- Lo crea Mateo a mano al correr este script contra el Postgres del
-- ambiente (el deploy no lo crea). CAMBIAR_EN_RAILWAY es un marcador,
-- nunca una contraseña: se reemplaza al correrlo y el valor real no
-- queda en el repo. Después se carga DATABASE_URL_FALABELLA en Railway.
-- El cron de pedidos Falabella solo enumera las cuentas conectadas de
-- CUALQUIER empresa: id, empresa_id y desconectada_ts. Nada de
-- user_id, api_key_cifrada ni escrituras. Credenciales, pedidos y
-- auditoría pasan por dbComoEmpresa()/app_user cuando ya se sabe la
-- empresa. Sumar una columna al SELECT de
-- lib/trabajos/sincronizarFalabella.ts sin sumarla acá da permission denied.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falabella_trabajador_user') THEN
    CREATE ROLE falabella_trabajador_user WITH LOGIN PASSWORD 'CAMBIAR_EN_RAILWAY';
  END IF;
END $$;
GRANT CONNECT ON DATABASE railway TO falabella_trabajador_user;
GRANT USAGE ON SCHEMA public TO falabella_trabajador_user;
GRANT SELECT (id, empresa_id, desconectada_ts) ON cuentas_falabella TO falabella_trabajador_user;

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
-- Issue #422 (fase 6, Disponible).
ALTER TABLE cuentas_disponible ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_disponible FORCE ROW LEVEL SECURITY;
ALTER TABLE saldos_disponible ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_disponible FORCE ROW LEVEL SECURITY;
-- Issue #129.
ALTER TABLE pedidos_finanzas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_finanzas FORCE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items FORCE ROW LEVEL SECURITY;
ALTER TABLE ventas_correcciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_correcciones FORCE ROW LEVEL SECURITY;
-- Issue #280.
ALTER TABLE bodegas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodegas FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_bodega ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_bodega FORCE ROW LEVEL SECURITY;
ALTER TABLE kardex_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kardex_movimientos FORCE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra FORCE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_items FORCE ROW LEVEL SECURITY;
ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepciones FORCE ROW LEVEL SECURITY;
ALTER TABLE recepcion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepcion_items FORCE ROW LEVEL SECURITY;
ALTER TABLE configuracion_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_inventario FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_stock_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_stock_ml FORCE ROW LEVEL SECURITY;
ALTER TABLE alertas_ultima_unidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas_ultima_unidad FORCE ROW LEVEL SECURITY;
-- Rama feat-promociones.
ALTER TABLE promociones_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE promociones_reglas FORCE ROW LEVEL SECURITY;
ALTER TABLE promociones_candidatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE promociones_candidatos FORCE ROW LEVEL SECURITY;
ALTER TABLE promociones_acciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE promociones_acciones FORCE ROW LEVEL SECURITY;
ALTER TABLE ia_conexiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_conexiones FORCE ROW LEVEL SECURITY;
ALTER TABLE ia_conexion_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_conexion_modulos FORCE ROW LEVEL SECURITY;
ALTER TABLE publicaciones_ia_trabajos ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicaciones_ia_trabajos FORCE ROW LEVEL SECURITY;
ALTER TABLE publicaciones_ia_imagenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicaciones_ia_imagenes FORCE ROW LEVEL SECURITY;
ALTER TABLE optimizacion_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimizacion_notas FORCE ROW LEVEL SECURITY;
ALTER TABLE optimizacion_revisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimizacion_revisiones FORCE ROW LEVEL SECURITY;
ALTER TABLE categorias_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_gasto FORCE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos FORCE ROW LEVEL SECURITY;
ALTER TABLE canva_conexiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE canva_conexiones FORCE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE accesos_temporales FORCE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ml FORCE ROW LEVEL SECURITY;
-- Conector Falabella (15/11) — mismo criterio simple que cuentas_ml/pedidos,
-- sin las políticas de transferencia/webhook (no hay OAuth ni aviso
-- entrante que resolver, es un primer corte más chico).
ALTER TABLE cuentas_falabella ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_falabella FORCE ROW LEVEL SECURITY;
ALTER TABLE pedidos_falabella ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_falabella FORCE ROW LEVEL SECURITY;
-- Issue #422 (Bloque 1) — conector OAuth de Mercado Pago, mismo criterio
-- simple que cuentas_falabella.
ALTER TABLE cuentas_mp ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_mp FORCE ROW LEVEL SECURITY;
ALTER TABLE movimientos_marketplace ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_marketplace FORCE ROW LEVEL SECURITY;
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
ALTER TABLE publicidad_campanas_cambios ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicidad_campanas_cambios FORCE ROW LEVEL SECURITY;

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

-- Issue #422 (fase 6) — mismo patrón: una empresa nunca ve ni toca las
-- cuentas ni los saldos de otra.
DROP POLICY IF EXISTS aislamiento_cuentas_disponible ON cuentas_disponible;
CREATE POLICY aislamiento_cuentas_disponible ON cuentas_disponible
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_saldos_disponible ON saldos_disponible;
CREATE POLICY aislamiento_saldos_disponible ON saldos_disponible
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Issue #129 — mismo patrón para la cabecera y las líneas de venta.
DROP POLICY IF EXISTS aislamiento_pedidos_finanzas ON pedidos_finanzas;
CREATE POLICY aislamiento_pedidos_finanzas ON pedidos_finanzas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_pedido_items ON pedido_items;
CREATE POLICY aislamiento_pedido_items ON pedido_items
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- ventas_correcciones: una política por comando. Se inserta activa
-- (sin anulada_ts) y el UPDATE (que el GRANT ya limita a anulada_ts)
-- solo toma una corrección activa y la deja anulada: no se des-anula
-- ni se cambia la fecha de una ya anulada.
DROP POLICY IF EXISTS aislamiento_ventas_correcciones ON ventas_correcciones;
DROP POLICY IF EXISTS ventas_correcciones_ver ON ventas_correcciones;
CREATE POLICY ventas_correcciones_ver ON ventas_correcciones FOR SELECT
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS ventas_correcciones_crear ON ventas_correcciones;
CREATE POLICY ventas_correcciones_crear ON ventas_correcciones FOR INSERT
  WITH CHECK (empresa_id = current_setting('app.empresa_actual', true)::uuid AND anulada_ts IS NULL);
DROP POLICY IF EXISTS ventas_correcciones_anular ON ventas_correcciones;
CREATE POLICY ventas_correcciones_anular ON ventas_correcciones FOR UPDATE
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid AND anulada_ts IS NULL)
  WITH CHECK (empresa_id = current_setting('app.empresa_actual', true)::uuid AND anulada_ts IS NOT NULL);

-- Issue #280 — mismo patrón en las tablas de inventario: una empresa
-- nunca ve ni mueve el stock, el kardex ni las compras de otra. Las
-- FK compuestas (empresa_id, ...) cierran el otro hueco: una fila de A
-- no puede apuntar a una bodega o un SKU de B.
DROP POLICY IF EXISTS aislamiento_bodegas ON bodegas;
CREATE POLICY aislamiento_bodegas ON bodegas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_stock_bodega ON stock_bodega;
CREATE POLICY aislamiento_stock_bodega ON stock_bodega
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_kardex_movimientos ON kardex_movimientos;
CREATE POLICY aislamiento_kardex_movimientos ON kardex_movimientos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_ordenes_compra ON ordenes_compra;
CREATE POLICY aislamiento_ordenes_compra ON ordenes_compra
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_orden_compra_items ON orden_compra_items;
CREATE POLICY aislamiento_orden_compra_items ON orden_compra_items
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_recepciones ON recepciones;
CREATE POLICY aislamiento_recepciones ON recepciones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_recepcion_items ON recepcion_items;
CREATE POLICY aislamiento_recepcion_items ON recepcion_items
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_configuracion_inventario ON configuracion_inventario;
CREATE POLICY aislamiento_configuracion_inventario ON configuracion_inventario
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_sync_stock_ml ON sync_stock_ml;
CREATE POLICY aislamiento_sync_stock_ml ON sync_stock_ml
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_alertas_ultima_unidad ON alertas_ultima_unidad;
CREATE POLICY aislamiento_alertas_ultima_unidad ON alertas_ultima_unidad
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Rama feat-promociones.
DROP POLICY IF EXISTS aislamiento_promociones_reglas ON promociones_reglas;
CREATE POLICY aislamiento_promociones_reglas ON promociones_reglas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_promociones_candidatos ON promociones_candidatos;
CREATE POLICY aislamiento_promociones_candidatos ON promociones_candidatos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_promociones_acciones ON promociones_acciones;
CREATE POLICY aislamiento_promociones_acciones ON promociones_acciones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_ia_conexiones ON ia_conexiones;
CREATE POLICY aislamiento_ia_conexiones ON ia_conexiones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_ia_conexion_modulos ON ia_conexion_modulos;
CREATE POLICY aislamiento_ia_conexion_modulos ON ia_conexion_modulos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Publicar → «Crear con IA» (PR2): cada empresa solo ve su historial.
DROP POLICY IF EXISTS aislamiento_publicaciones_ia_trabajos ON publicaciones_ia_trabajos;
CREATE POLICY aislamiento_publicaciones_ia_trabajos ON publicaciones_ia_trabajos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_publicaciones_ia_imagenes ON publicaciones_ia_imagenes;
CREATE POLICY aislamiento_publicaciones_ia_imagenes ON publicaciones_ia_imagenes
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Optimización → bitácora: cada empresa solo ve sus notas y revisiones.
DROP POLICY IF EXISTS aislamiento_optimizacion_notas ON optimizacion_notas;
CREATE POLICY aislamiento_optimizacion_notas ON optimizacion_notas
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);
DROP POLICY IF EXISTS aislamiento_optimizacion_revisiones ON optimizacion_revisiones;
CREATE POLICY aislamiento_optimizacion_revisiones ON optimizacion_revisiones
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Issue #422 — gastos externos: una empresa nunca ve ni toca los gastos
-- ni las categorías de otra.
DROP POLICY IF EXISTS aislamiento_categorias_gasto ON categorias_gasto;
CREATE POLICY aislamiento_categorias_gasto ON categorias_gasto
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_gastos ON gastos;
CREATE POLICY aislamiento_gastos ON gastos
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Tarea "Publicar — conectar Canva" — a diferencia de TODAS las demás
-- políticas de arriba (que filtran solo por empresa_id), esta filtra
-- por empresa_id Y usuario_id a la vez: una persona de la empresa
-- nunca ve ni usa la conexión de Canva de otra persona de la MISMA
-- empresa, aunque comparta rol o permisos (pedido explícito — el link
-- de "Compartir" de un diseño de Canva es personal). Requiere el
-- contexto nuevo dbComoEmpresaYUsuario (db/empresa-context.ts), que
-- fija los dos current_setting reales a la vez — dbComoEmpresa() solo
-- fija empresa_actual, así que con ese contexto esta política nunca
-- deja ver ninguna fila (usuario_actual queda sin fijar → NULL).
DROP POLICY IF EXISTS aislamiento_canva_conexiones ON canva_conexiones;
CREATE POLICY aislamiento_canva_conexiones ON canva_conexiones
  USING (
    empresa_id = current_setting('app.empresa_actual', true)::uuid
    AND usuario_id = NULLIF(current_setting('app.usuario_actual', true), '')::uuid
  );

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

DROP POLICY IF EXISTS aislamiento_cuentas_falabella ON cuentas_falabella;
CREATE POLICY aislamiento_cuentas_falabella ON cuentas_falabella
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_cuentas_mp ON cuentas_mp;
CREATE POLICY aislamiento_cuentas_mp ON cuentas_mp
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_pedidos_falabella ON pedidos_falabella;
CREATE POLICY aislamiento_pedidos_falabella ON pedidos_falabella
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

DROP POLICY IF EXISTS aislamiento_movimientos_marketplace ON movimientos_marketplace;
CREATE POLICY aislamiento_movimientos_marketplace ON movimientos_marketplace
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

DROP POLICY IF EXISTS aislamiento_publicidad_campanas_cambios ON publicidad_campanas_cambios;
CREATE POLICY aislamiento_publicidad_campanas_cambios ON publicidad_campanas_cambios
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- El cron lista cuentas y la bitácora de cualquier empresa. No
-- reemplaza el aislamiento de app_user: el TO limita estas políticas
-- a publicidad_trabajador_user.
DROP POLICY IF EXISTS publicidad_trabajador_lee_cuentas_ml ON cuentas_ml;
CREATE POLICY publicidad_trabajador_lee_cuentas_ml ON cuentas_ml FOR SELECT TO publicidad_trabajador_user USING (true);
DROP POLICY IF EXISTS publicidad_trabajador_lee_sincronizaciones ON publicidad_sincronizaciones;
CREATE POLICY publicidad_trabajador_lee_sincronizaciones ON publicidad_sincronizaciones FOR SELECT TO publicidad_trabajador_user USING (true);

-- Issue #422 — el cron de pedidos Falabella lista las cuentas de
-- cualquier empresa (solo las columnas del GRANT de 1f). El TO limita
-- la política a falabella_trabajador_user; app_user sigue aislado.
DROP POLICY IF EXISTS falabella_trabajador_lee_cuentas ON cuentas_falabella;
CREATE POLICY falabella_trabajador_lee_cuentas ON cuentas_falabella FOR SELECT TO falabella_trabajador_user USING (true);

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

-- PR B — la única política de UPDATE de superadmin_user; lo que puede
-- tocar lo limita el GRANT por columna de arriba, no esta política.
DROP POLICY IF EXISTS superadmin_edita_empresas ON empresas;
CREATE POLICY superadmin_edita_empresas ON empresas FOR UPDATE TO superadmin_user USING (true);

-- PR B — conteos por empresa para la lista de /superadmin. superadmin_user
-- NO tiene SELECT sobre cuentas_ml, cuentas_falabella ni auditoria (y no
-- se le da): esta función SECURITY DEFINER devuelve SOLO números y una
-- fecha por empresa — nunca una fila de cuenta, de pedido ni de comprador.
-- search_path fijo: sin eso una función SECURITY DEFINER es secuestrable
-- con un objeto del mismo nombre en otro esquema.
CREATE OR REPLACE FUNCTION superadmin_resumen_empresas()
RETURNS TABLE (empresa_id uuid, miembros bigint, cuentas_ml bigint, cuentas_falabella bigint, ultima_actividad timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT e.id,
    (SELECT count(*) FROM membresias m WHERE m.empresa_id = e.id),
    (SELECT count(*) FROM cuentas_ml c WHERE c.empresa_id = e.id AND c.desconectada_ts IS NULL),
    (SELECT count(*) FROM cuentas_falabella f WHERE f.empresa_id = e.id AND f.desconectada_ts IS NULL),
    (SELECT max(a.ts) FROM auditoria a WHERE a.empresa_id = e.id)
  FROM empresas e
$fn$;
REVOKE ALL ON FUNCTION superadmin_resumen_empresas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin_resumen_empresas() TO superadmin_user;

-- Salud de conexiones (25-nov) para /superadmin/conexiones: mismo patrón
-- que superadmin_resumen_empresas — SOLO conteos por empresa, nunca una
-- fila de cuenta, aviso ni sincronización (decisión D8). Umbrales:
--   ml_sin_renovar: cuenta conectada cuyo token venció hace más de 24 h.
--     Los procesos lo renuevan solos al usarlo (publicidad, avisos), así
--     que si sigue vencido es señal de que la renovación está fallando.
--   avisos_atrasados: avisos de ML sin procesar con más de 1 h.
--   publicidad_con_error: cuentas conectadas cuya ÚLTIMA sincronización
--     de publicidad terminó en 'error'.
CREATE OR REPLACE FUNCTION superadmin_salud_conexiones()
RETURNS TABLE (
  empresa_id uuid,
  ml_conectadas bigint,
  ml_desconectadas bigint,
  ml_sin_renovar bigint,
  avisos_atrasados bigint,
  publicidad_con_error bigint,
  falabella_desconectadas bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT e.id,
    (SELECT count(*) FROM cuentas_ml c WHERE c.empresa_id = e.id AND c.desconectada_ts IS NULL),
    (SELECT count(*) FROM cuentas_ml c WHERE c.empresa_id = e.id AND c.desconectada_ts IS NOT NULL),
    (SELECT count(*) FROM cuentas_ml c WHERE c.empresa_id = e.id AND c.desconectada_ts IS NULL AND c.token_expira_ts < now() - interval '24 hours'),
    (SELECT count(*) FROM avisos_ml a WHERE a.empresa_id = e.id AND a.procesado_ts IS NULL AND a.recibido_ts < now() - interval '1 hour'),
    (SELECT count(*) FROM cuentas_ml c WHERE c.empresa_id = e.id AND c.desconectada_ts IS NULL
       AND (SELECT s.estado FROM publicidad_sincronizaciones s WHERE s.cuenta_ml_id = c.id ORDER BY s.iniciada_ts DESC LIMIT 1) = 'error'),
    (SELECT count(*) FROM cuentas_falabella f WHERE f.empresa_id = e.id AND f.desconectada_ts IS NOT NULL)
  FROM empresas e
$fn$;
REVOKE ALL ON FUNCTION superadmin_salud_conexiones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin_salud_conexiones() TO superadmin_user;

-- Auditoría del superadmin (solo lectura en /superadmin/auditoria). superadmin_user
-- no tiene SELECT sobre auditoria: esta función SECURITY DEFINER devuelve solo las
-- filas cuyo autor es una cuenta superadmin, y solo ts/accion/entidad/nombre de
-- empresa/detalle (nunca valor_anterior/valor_nuevo). Límite acotado a 1..200.
CREATE OR REPLACE FUNCTION superadmin_acciones_recientes(limite integer DEFAULT 100)
RETURNS TABLE (ts timestamptz, accion text, entidad text, empresa_nombre text, detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT a.ts, a.accion, a.entidad, coalesce(e.nombre, b.nombre), a.detalle
  FROM auditoria a
  JOIN usuarios u ON u.id = a.usuario_id AND u.es_superadmin
  LEFT JOIN empresas e ON e.id = a.empresa_id
  LEFT JOIN bodegas_3pl b ON b.id = a.bodega_id
  ORDER BY a.ts DESC
  LIMIT greatest(1, least(coalesce(limite, 100), 200))
$fn$;
REVOKE ALL ON FUNCTION superadmin_acciones_recientes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin_acciones_recientes(integer) TO superadmin_user;

-- Estado de los procesos (25-nov, migración 0047). ejecuciones_procesos no
-- tiene GRANT para ningún usuario de la app: cada proceso escribe SOLO su
-- propia fila con registrar_ejecucion_proceso() (el usuario de base que
-- llama decide qué proceso puede anotar — trabajador_user nunca puede
-- anotar una corrida de publicidad, ni al revés), y el superadmin la lee
-- con superadmin_estado_procesos(). RLS forzado y sin políticas: aunque un
-- GRANT se colara por error, ninguna fila sería visible.
ALTER TABLE ejecuciones_procesos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones_procesos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ejecuciones_procesos FROM PUBLIC;

-- Guarda 14 días por proceso (avisos corre cada 5 min ≈ 4.000 filas) y
-- borra lo más viejo en la misma llamada, sin cron aparte. session_user
-- (no current_user, que dentro de SECURITY DEFINER es el dueño de la
-- función) es el usuario con el que se conectó el proceso.
CREATE OR REPLACE FUNCTION registrar_ejecucion_proceso(p_proceso text, p_inicio timestamptz, p_ok boolean, p_resumen jsonb, p_error text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  permitido text := CASE session_user
    WHEN 'trabajador_user' THEN 'avisos_ml'
    WHEN 'publicidad_trabajador_user' THEN 'publicidad'
    WHEN 'seguimiento_trabajador_user' THEN 'seguimiento'
  END;
BEGIN
  IF permitido IS NULL OR permitido IS DISTINCT FROM p_proceso THEN
    RAISE EXCEPTION 'El usuario % no puede registrar corridas de %', session_user, p_proceso;
  END IF;
  INSERT INTO ejecuciones_procesos (proceso, inicio_ts, ok, resumen, error)
  VALUES (
    p_proceso,
    p_inicio,
    p_ok,
    CASE WHEN jsonb_typeof(p_resumen) = 'object' THEN p_resumen ELSE '{}'::jsonb END,
    left(p_error, 300)
  );
  DELETE FROM ejecuciones_procesos WHERE proceso = p_proceso AND inicio_ts < now() - interval '14 days';
END
$fn$;
REVOKE ALL ON FUNCTION registrar_ejecucion_proceso(text, timestamptz, boolean, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_ejecucion_proceso(text, timestamptz, boolean, jsonb, text)
  TO trabajador_user, publicidad_trabajador_user, seguimiento_trabajador_user;

-- Una fila por proceso, aunque nunca haya corrido (ultima_ts NULL).
CREATE OR REPLACE FUNCTION superadmin_estado_procesos()
RETURNS TABLE (
  proceso text,
  ultima_ts timestamptz,
  ultima_ok boolean,
  ultimo_resumen jsonb,
  ultimo_error text,
  ultima_exitosa_ts timestamptz,
  corridas_24h bigint,
  fallidas_24h bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT p.proceso, u.inicio_ts, u.ok, u.resumen, u.error,
    (SELECT max(e.inicio_ts) FROM ejecuciones_procesos e WHERE e.proceso = p.proceso AND e.ok),
    (SELECT count(*) FROM ejecuciones_procesos e WHERE e.proceso = p.proceso AND e.inicio_ts > now() - interval '24 hours'),
    (SELECT count(*) FROM ejecuciones_procesos e WHERE e.proceso = p.proceso AND e.inicio_ts > now() - interval '24 hours' AND NOT e.ok)
  FROM (VALUES ('avisos_ml'), ('publicidad'), ('seguimiento')) AS p(proceso)
  LEFT JOIN LATERAL (
    SELECT e.inicio_ts, e.ok, e.resumen, e.error FROM ejecuciones_procesos e
    WHERE e.proceso = p.proceso ORDER BY e.inicio_ts DESC LIMIT 1
  ) u ON true
$fn$;
REVOKE ALL ON FUNCTION superadmin_estado_procesos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin_estado_procesos() TO superadmin_user;

-- Cola de avisos de toda la plataforma: solo dos números.
CREATE OR REPLACE FUNCTION superadmin_avisos_en_cola()
RETURNS TABLE (pendientes bigint, atrasados bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT count(*), count(*) FILTER (WHERE recibido_ts < now() - interval '1 hour')
  FROM avisos_ml WHERE procesado_ts IS NULL
$fn$;
REVOKE ALL ON FUNCTION superadmin_avisos_en_cola() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin_avisos_en_cola() TO superadmin_user;

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

-- Issue #623 (SA-Soporte, migración 0043) — tickets de soporte. La
-- empresa solo ve y abre los suyos; nadie borra nada. app_user solo
-- puede tocar actualizado_ts del ticket (al responder): el estado lo
-- cambia únicamente superadmin_user, y solo estado/actualizado_ts. El
-- superadmin lee el ticket y su conversación — lo que el vendedor
-- escribió a propósito — y ninguna otra tabla de la empresa (D8).
GRANT SELECT, INSERT ON tickets_soporte, mensajes_ticket_soporte TO app_user;
GRANT UPDATE (actualizado_ts) ON tickets_soporte TO app_user;
REVOKE DELETE ON tickets_soporte, mensajes_ticket_soporte FROM app_user;
GRANT SELECT ON tickets_soporte, mensajes_ticket_soporte TO superadmin_user;
GRANT INSERT ON mensajes_ticket_soporte TO superadmin_user;
GRANT UPDATE (estado, actualizado_ts) ON tickets_soporte TO superadmin_user;

ALTER TABLE tickets_soporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets_soporte FORCE ROW LEVEL SECURITY;
ALTER TABLE mensajes_ticket_soporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_ticket_soporte FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aislamiento_tickets_soporte ON tickets_soporte;
CREATE POLICY aislamiento_tickets_soporte ON tickets_soporte
  USING (empresa_id = current_setting('app.empresa_actual', true)::uuid);

-- Un ticket nuevo siempre nace abierto, lo mande quien lo mande.
DROP POLICY IF EXISTS tickets_soporte_nace_abierto ON tickets_soporte;
CREATE POLICY tickets_soporte_nace_abierto ON tickets_soporte AS RESTRICTIVE FOR INSERT TO app_user
  WITH CHECK (estado = 'abierto');

-- Sin empresa_id propio: el mensaje se ve si su ticket se ve (la
-- subconsulta ya pasa por la política de tickets_soporte).
DROP POLICY IF EXISTS aislamiento_mensajes_ticket_soporte ON mensajes_ticket_soporte;
CREATE POLICY aislamiento_mensajes_ticket_soporte ON mensajes_ticket_soporte TO app_user
  USING (EXISTS (SELECT 1 FROM tickets_soporte t WHERE t.id = ticket_id));

-- Un mensaje de la empresa nunca se hace pasar por el del superadmin.
DROP POLICY IF EXISTS mensajes_ticket_soporte_no_superadmin ON mensajes_ticket_soporte;
CREATE POLICY mensajes_ticket_soporte_no_superadmin ON mensajes_ticket_soporte AS RESTRICTIVE FOR INSERT TO app_user
  WITH CHECK (es_superadmin = false);

DROP POLICY IF EXISTS sa_tickets_soporte_ver ON tickets_soporte;
CREATE POLICY sa_tickets_soporte_ver ON tickets_soporte FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_tickets_soporte_estado ON tickets_soporte;
CREATE POLICY sa_tickets_soporte_estado ON tickets_soporte FOR UPDATE TO superadmin_user USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sa_mensajes_ticket_soporte_ver ON mensajes_ticket_soporte;
CREATE POLICY sa_mensajes_ticket_soporte_ver ON mensajes_ticket_soporte FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_mensajes_ticket_soporte_responder ON mensajes_ticket_soporte;
CREATE POLICY sa_mensajes_ticket_soporte_responder ON mensajes_ticket_soporte FOR INSERT TO superadmin_user
  WITH CHECK (es_superadmin = true);

-- ---------------------------------------------------------------------
-- PR login-bodega-domiciliario — bodegas 3PL (operador logístico) y sus
-- domiciliarios. Mundo APARTE de las empresas de vendedores: variables de
-- sesión propias (app.bodega_id, app.bodega_usuario_id,
-- app.bodega_invitacion_token, db/bodega-context.ts) que NINGÚN contexto
-- de vendedor fija, y todas las políticas con NULLIF(...)::uuid: sin la
-- variable no hay filas (nunca un error de cast). En el sentido
-- contrario, db/bodega-context.ts fija app.empresa_actual al UUID
-- centinela: una bodega no lee nada de empresas de vendedores.
-- ---------------------------------------------------------------------
ALTER TABLE bodegas_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodegas_3pl FORCE ROW LEVEL SECURITY;
ALTER TABLE miembros_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembros_bodega_3pl FORCE ROW LEVEL SECURITY;
ALTER TABLE invitaciones_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones_bodega_3pl FORCE ROW LEVEL SECURITY;

-- app_user: la bodega solo edita nombre y NIT de la suya; estado lo cambia
-- únicamente el superadmin. Un miembro solo cambia rol/activo (nunca a qué
-- bodega ni a qué persona pertenece); nada se borra.
GRANT SELECT ON bodegas_3pl TO app_user;
REVOKE INSERT, DELETE ON bodegas_3pl FROM app_user;
REVOKE UPDATE ON bodegas_3pl FROM app_user;
GRANT UPDATE (nombre, nit) ON bodegas_3pl TO app_user;
GRANT SELECT, INSERT ON miembros_bodega_3pl TO app_user;
REVOKE UPDATE, DELETE ON miembros_bodega_3pl FROM app_user;
GRANT UPDATE (rol, activo) ON miembros_bodega_3pl TO app_user;
GRANT SELECT, INSERT ON invitaciones_bodega_3pl TO app_user;
REVOKE UPDATE, DELETE ON invitaciones_bodega_3pl FROM app_user;
GRANT UPDATE (aceptada_ts) ON invitaciones_bodega_3pl TO app_user;

-- bodegas_3pl: ve la bodega activa y aquellas donde es miembro (el selector).
-- Editar nombre/NIT: solo admin_bodega (app.bodega_rol) de la bodega activa.
DROP POLICY IF EXISTS bodega3pl_ver ON bodegas_3pl;
CREATE POLICY bodega3pl_ver ON bodegas_3pl FOR SELECT TO app_user
  USING (
    id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    OR id IN (
      SELECT bodega_id FROM miembros_bodega_3pl
      WHERE usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    )
  );
DROP POLICY IF EXISTS bodega3pl_editar ON bodegas_3pl;
CREATE POLICY bodega3pl_editar ON bodegas_3pl FOR UPDATE TO app_user
  USING (
    id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  );

-- miembros_bodega_3pl: ve los de la bodega activa y las filas propias; cambia
-- rol/activo solo dentro de la bodega activa Y solo si la sesión declara
-- app.bodega_rol = 'admin_bodega' (vacío = sin permiso); se agrega UNA fila propia solo
-- con el token de una invitación vigente, de esa bodega y de ese rol.
DROP POLICY IF EXISTS miembro3pl_ver ON miembros_bodega_3pl;
CREATE POLICY miembro3pl_ver ON miembros_bodega_3pl FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    OR usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
  );
DROP POLICY IF EXISTS miembro3pl_editar ON miembros_bodega_3pl;
CREATE POLICY miembro3pl_editar ON miembros_bodega_3pl FOR UPDATE TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  )
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  );
DROP POLICY IF EXISTS miembro3pl_agregar_por_invitacion ON miembros_bodega_3pl;
CREATE POLICY miembro3pl_agregar_por_invitacion ON miembros_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM invitaciones_bodega_3pl i
      WHERE i.token = current_setting('app.bodega_invitacion_token', true)
        AND i.bodega_id = miembros_bodega_3pl.bodega_id
        AND i.rol = miembros_bodega_3pl.rol
        AND i.aceptada_ts IS NULL
        AND i.expira_ts > now()
    )
  );

-- invitaciones_bodega_3pl: la bodega activa ve las suyas y quien tiene el
-- token ve esa fila; el admin_bodega solo invita operario o domiciliario
-- (admin_bodega lo invita el superadmin); aceptar = marcar aceptada_ts.
DROP POLICY IF EXISTS inv3pl_ver ON invitaciones_bodega_3pl;
CREATE POLICY inv3pl_ver ON invitaciones_bodega_3pl FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    OR token = current_setting('app.bodega_invitacion_token', true)
  );
DROP POLICY IF EXISTS inv3pl_crear ON invitaciones_bodega_3pl;
CREATE POLICY inv3pl_crear ON invitaciones_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND rol IN ('operario', 'domiciliario')
  );
DROP POLICY IF EXISTS inv3pl_aceptar ON invitaciones_bodega_3pl;
CREATE POLICY inv3pl_aceptar ON invitaciones_bodega_3pl FOR UPDATE TO app_user
  USING (token = current_setting('app.bodega_invitacion_token', true))
  WITH CHECK (token = current_setting('app.bodega_invitacion_token', true));

-- auditoria: las acciones de una bodega llevan bodega_id (empresa_id vacío).
-- Solo se escribe y se lee dentro de la bodega activa; la política de
-- empresas (aislamiento_auditoria) no ve estas filas porque su empresa_id
-- es nulo.
DROP POLICY IF EXISTS auditoria_bodega_escribir ON auditoria;
CREATE POLICY auditoria_bodega_escribir ON auditoria FOR INSERT TO app_user
  WITH CHECK (bodega_id IS NOT NULL AND bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);
DROP POLICY IF EXISTS auditoria_bodega_leer ON auditoria;
CREATE POLICY auditoria_bodega_leer ON auditoria FOR SELECT TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);

-- Autorregistro (Registro-0): una persona crea SU bodega y se vuelve su único
-- admin_bodega. El INSERT exige origen autorregistro, estado activa,
-- creado_por = la persona e id = la bodega fijada por
-- dbComoAutorregistroBodega. No depender de RETURNING (el id se genera en
-- código). Una sola por persona: índice único parcial.
GRANT INSERT ON bodegas_3pl TO app_user;
DROP POLICY IF EXISTS bodega3pl_autorregistro ON bodegas_3pl;
CREATE POLICY bodega3pl_autorregistro ON bodegas_3pl FOR INSERT TO app_user
  WITH CHECK (
    origen = 'autorregistro'
    AND estado = 'activa'
    AND creado_por = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
  );

-- Primer admin de una bodega autorregistrada: solo ella misma, solo admin y
-- solo mientras la bodega no tenga ningún miembro (nadie se hace admin de una
-- bodega ajena ni agrega un segundo admin por esta vía).
DROP POLICY IF EXISTS miembro3pl_admin_autorregistro ON miembros_bodega_3pl;
CREATE POLICY miembro3pl_admin_autorregistro ON miembros_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    rol = 'admin_bodega'
    AND usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    AND bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl b
      WHERE b.id = miembros_bodega_3pl.bodega_id
        AND b.origen = 'autorregistro'
        AND b.creado_por = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM miembros_bodega_3pl m WHERE m.bodega_id = miembros_bodega_3pl.bodega_id
    )
  );

-- perfiles_domiciliario: cada persona solo ve, crea y edita (nombre, teléfono,
-- ciudad) SU fila; nada se borra. El superadmin solo cuenta (SELECT).
ALTER TABLE perfiles_domiciliario ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfiles_domiciliario FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON perfiles_domiciliario TO app_user;
REVOKE UPDATE, DELETE ON perfiles_domiciliario FROM app_user;
GRANT UPDATE (nombre, telefono, ciudad) ON perfiles_domiciliario TO app_user;
GRANT SELECT ON perfiles_domiciliario TO superadmin_user;
DROP POLICY IF EXISTS perfil_domiciliario_ver ON perfiles_domiciliario;
CREATE POLICY perfil_domiciliario_ver ON perfiles_domiciliario FOR SELECT TO app_user
  USING (usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid);
DROP POLICY IF EXISTS perfil_domiciliario_crear ON perfiles_domiciliario;
CREATE POLICY perfil_domiciliario_crear ON perfiles_domiciliario FOR INSERT TO app_user
  WITH CHECK (usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid);
DROP POLICY IF EXISTS perfil_domiciliario_editar ON perfiles_domiciliario;
CREATE POLICY perfil_domiciliario_editar ON perfiles_domiciliario FOR UPDATE TO app_user
  USING (usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid);
DROP POLICY IF EXISTS sa_perfil_domiciliario_ver ON perfiles_domiciliario;
CREATE POLICY sa_perfil_domiciliario_ver ON perfiles_domiciliario FOR SELECT TO superadmin_user USING (true);

-- sedes_bodega: varias sedes por bodega. Todos los miembros de la bodega las
-- leen; solo el admin_bodega crea y edita (nombre, dirección, ciudad, activa);
-- nada se borra. El superadmin solo cuenta (SELECT).
ALTER TABLE sedes_bodega ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes_bodega FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sedes_bodega TO app_user;
REVOKE UPDATE, DELETE ON sedes_bodega FROM app_user;
GRANT UPDATE (nombre, direccion, ciudad, activa) ON sedes_bodega TO app_user;
GRANT SELECT ON sedes_bodega TO superadmin_user;
DROP POLICY IF EXISTS sede_bodega_ver ON sedes_bodega;
CREATE POLICY sede_bodega_ver ON sedes_bodega FOR SELECT TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);
DROP POLICY IF EXISTS sede_bodega_crear ON sedes_bodega;
CREATE POLICY sede_bodega_crear ON sedes_bodega FOR INSERT TO app_user
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  );
DROP POLICY IF EXISTS sede_bodega_editar ON sedes_bodega;
CREATE POLICY sede_bodega_editar ON sedes_bodega FOR UPDATE TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  )
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'admin_bodega'
  );
DROP POLICY IF EXISTS sa_sede_bodega_ver ON sedes_bodega;
CREATE POLICY sa_sede_bodega_ver ON sedes_bodega FOR SELECT TO superadmin_user USING (true);

-- auditoria del perfil de domiciliario: aún no pertenece a ninguna bodega ni
-- empresa; solo se escribe la propia acción de la persona.
DROP POLICY IF EXISTS auditoria_perfil_domiciliario_escribir ON auditoria;
CREATE POLICY auditoria_perfil_domiciliario_escribir ON auditoria FOR INSERT TO app_user
  WITH CHECK (
    bodega_id IS NULL AND empresa_id IS NULL
    AND entidad = 'perfil_domiciliario'
    AND usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
  );

-- superadmin_user: crea y suspende/reactiva bodegas, ve sus miembros (conteos)
-- e invita SOLO al admin_bodega. No edita miembros ni lee auditoria.
GRANT SELECT, INSERT ON bodegas_3pl TO superadmin_user;
GRANT UPDATE (estado) ON bodegas_3pl TO superadmin_user;
GRANT SELECT ON miembros_bodega_3pl TO superadmin_user;
GRANT SELECT, INSERT ON invitaciones_bodega_3pl TO superadmin_user;
DROP POLICY IF EXISTS sa_bodegas_ver ON bodegas_3pl;
CREATE POLICY sa_bodegas_ver ON bodegas_3pl FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_bodegas_crear ON bodegas_3pl;
CREATE POLICY sa_bodegas_crear ON bodegas_3pl FOR INSERT TO superadmin_user WITH CHECK (true);
DROP POLICY IF EXISTS sa_bodegas_estado ON bodegas_3pl;
CREATE POLICY sa_bodegas_estado ON bodegas_3pl FOR UPDATE TO superadmin_user USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sa_miembros_bodega_ver ON miembros_bodega_3pl;
CREATE POLICY sa_miembros_bodega_ver ON miembros_bodega_3pl FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_inv_bodega_ver ON invitaciones_bodega_3pl;
CREATE POLICY sa_inv_bodega_ver ON invitaciones_bodega_3pl FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_inv_bodega_crear_admin ON invitaciones_bodega_3pl;
CREATE POLICY sa_inv_bodega_crear_admin ON invitaciones_bodega_3pl FOR INSERT TO superadmin_user WITH CHECK (rol = 'admin_bodega');

-- ---------------------------------------------------------------------
-- Issue #625 (Bodega-1, migración 0044) — bodegas 3PL ligadas a las
-- empresas que atienden, y las tablas de Bodega-2 (recepción e
-- inventario). La bodega ve solo filas con su app.bodega_id; la empresa,
-- solo filas con su app.empresa_actual (NULLIF: sin variable no hay
-- filas, nunca un error de cast). Ligar y pausar solo lo hace el
-- superadmin: app_user no tiene INSERT/UPDATE/DELETE sobre el vínculo.
-- ---------------------------------------------------------------------
ALTER TABLE bodegas_3pl_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodegas_3pl_empresas FORCE ROW LEVEL SECURITY;
ALTER TABLE recepciones_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepciones_bodega_3pl FORCE ROW LEVEL SECURITY;
ALTER TABLE recepcion_items_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepcion_items_bodega_3pl FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_bodega_3pl FORCE ROW LEVEL SECURITY;

GRANT SELECT ON bodegas_3pl_empresas TO app_user;
REVOKE INSERT, UPDATE, DELETE ON bodegas_3pl_empresas FROM app_user;
GRANT SELECT, INSERT ON recepciones_bodega_3pl, recepcion_items_bodega_3pl TO app_user;
REVOKE UPDATE, DELETE ON recepciones_bodega_3pl, recepcion_items_bodega_3pl FROM app_user;
GRANT SELECT, INSERT ON stock_bodega_3pl TO app_user;
GRANT UPDATE (cantidad) ON stock_bodega_3pl TO app_user;
REVOKE DELETE ON stock_bodega_3pl FROM app_user;
GRANT SELECT, INSERT ON bodegas_3pl_empresas TO superadmin_user;
GRANT UPDATE (estado) ON bodegas_3pl_empresas TO superadmin_user;

DROP POLICY IF EXISTS vinculo3pl_bodega_ver ON bodegas_3pl_empresas;
CREATE POLICY vinculo3pl_bodega_ver ON bodegas_3pl_empresas FOR SELECT TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);
DROP POLICY IF EXISTS vinculo3pl_empresa_ver ON bodegas_3pl_empresas;
CREATE POLICY vinculo3pl_empresa_ver ON bodegas_3pl_empresas FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);
DROP POLICY IF EXISTS sa_vinculo3pl_ver ON bodegas_3pl_empresas;
CREATE POLICY sa_vinculo3pl_ver ON bodegas_3pl_empresas FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS sa_vinculo3pl_ligar ON bodegas_3pl_empresas;
CREATE POLICY sa_vinculo3pl_ligar ON bodegas_3pl_empresas FOR INSERT TO superadmin_user WITH CHECK (true);
DROP POLICY IF EXISTS sa_vinculo3pl_pausar ON bodegas_3pl_empresas;
CREATE POLICY sa_vinculo3pl_pausar ON bodegas_3pl_empresas FOR UPDATE TO superadmin_user USING (true) WITH CHECK (true);

-- El vendedor ve el nombre de la bodega que lo atiende (solo la ligada) y
-- la bodega ve el nombre de las empresas que atiende (solo las ligadas).
-- Los subselects pasan por las políticas del vínculo, de arriba. La
-- aplicación (lib/bodega/empresas.ts) lee únicamente id y nombre.
DROP POLICY IF EXISTS bodega3pl_ver_empresa_ligada ON bodegas_3pl;
CREATE POLICY bodega3pl_ver_empresa_ligada ON bodegas_3pl FOR SELECT TO app_user
  USING (id IN (SELECT bodega_id FROM bodegas_3pl_empresas WHERE empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid));
DROP POLICY IF EXISTS empresas_ver_por_bodega_ligada ON empresas;
CREATE POLICY empresas_ver_por_bodega_ligada ON empresas FOR SELECT TO app_user
  USING (id IN (SELECT empresa_id FROM bodegas_3pl_empresas WHERE bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid));

-- Recepciones y stock: la bodega las crea y ve solo con su bodega_id y
-- una empresa ligada ACTIVA; la empresa solo las lee.
DROP POLICY IF EXISTS recepcion3pl_bodega_ver ON recepciones_bodega_3pl;
CREATE POLICY recepcion3pl_bodega_ver ON recepciones_bodega_3pl FOR SELECT TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);
DROP POLICY IF EXISTS recepcion3pl_empresa_ver ON recepciones_bodega_3pl;
CREATE POLICY recepcion3pl_empresa_ver ON recepciones_bodega_3pl FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);
DROP POLICY IF EXISTS recepcion3pl_bodega_crear ON recepciones_bodega_3pl;
CREATE POLICY recepcion3pl_bodega_crear ON recepciones_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v
      WHERE v.bodega_id = recepciones_bodega_3pl.bodega_id
        AND v.empresa_id = recepciones_bodega_3pl.empresa_id
        AND v.estado = 'activa'
    )
  );

-- Sin bodega_id propio: el ítem se ve si su recepción se ve, y solo se
-- agrega a una recepción de la bodega activa.
DROP POLICY IF EXISTS recepcion_item3pl_ver ON recepcion_items_bodega_3pl;
CREATE POLICY recepcion_item3pl_ver ON recepcion_items_bodega_3pl FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM recepciones_bodega_3pl r WHERE r.id = recepcion_id));
DROP POLICY IF EXISTS recepcion_item3pl_crear ON recepcion_items_bodega_3pl;
CREATE POLICY recepcion_item3pl_crear ON recepcion_items_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (EXISTS (
    SELECT 1 FROM recepciones_bodega_3pl r
    WHERE r.id = recepcion_id AND r.bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS stock3pl_bodega_ver ON stock_bodega_3pl;
CREATE POLICY stock3pl_bodega_ver ON stock_bodega_3pl FOR SELECT TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);
DROP POLICY IF EXISTS stock3pl_empresa_ver ON stock_bodega_3pl;
CREATE POLICY stock3pl_empresa_ver ON stock_bodega_3pl FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);
DROP POLICY IF EXISTS stock3pl_bodega_crear ON stock_bodega_3pl;
CREATE POLICY stock3pl_bodega_crear ON stock_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v
      WHERE v.bodega_id = stock_bodega_3pl.bodega_id AND v.empresa_id = stock_bodega_3pl.empresa_id AND v.estado = 'activa'
    )
  );
DROP POLICY IF EXISTS stock3pl_bodega_editar ON stock_bodega_3pl;
CREATE POLICY stock3pl_bodega_editar ON stock_bodega_3pl FOR UPDATE TO app_user
  USING (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid)
  WITH CHECK (bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- Issue #628 (Bodega-3, migración 0046) — despachos de la bodega 3PL.
-- La bodega NO lee pedidos ni despachos_ml (RLS filtra filas, no columnas, y
-- ahí hay precios, comisiones, guía y SLA). Lee solo esta copia mínima que
-- el vendedor llena al enviar el pedido a su bodega: número de pedido, tipo
-- de envío, SKU y cantidad. Nada del comprador.
-- · La empresa crea (hacia una bodega con vínculo ACTIVO, siempre 'pendiente')
--   y lee los suyos.
-- · La bodega lee los de su bodega_id y solo cambia estado/preparado_*:
--   de 'pendiente' a 'preparado', una sola vez (USING exige 'pendiente').
-- · Sin DELETE para nadie. Items: solo se agregan junto a una cabecera
--   pendiente de la empresa.
-- ---------------------------------------------------------------------
ALTER TABLE despachos_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos_bodega_3pl FORCE ROW LEVEL SECURITY;
ALTER TABLE despacho_items_bodega_3pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho_items_bodega_3pl FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON despachos_bodega_3pl, despacho_items_bodega_3pl TO app_user;
REVOKE UPDATE, DELETE ON despachos_bodega_3pl, despacho_items_bodega_3pl FROM app_user;
GRANT UPDATE (estado, preparado_ts, preparado_por) ON despachos_bodega_3pl TO app_user;

DROP POLICY IF EXISTS despacho3pl_bodega_ver ON despachos_bodega_3pl;
CREATE POLICY despacho3pl_bodega_ver ON despachos_bodega_3pl FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
  );
DROP POLICY IF EXISTS despacho3pl_empresa_ver ON despachos_bodega_3pl;
CREATE POLICY despacho3pl_empresa_ver ON despachos_bodega_3pl FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);
DROP POLICY IF EXISTS despacho3pl_empresa_crear ON despachos_bodega_3pl;
CREATE POLICY despacho3pl_empresa_crear ON despachos_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND estado = 'pendiente'
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v
      WHERE v.bodega_id = despachos_bodega_3pl.bodega_id
        AND v.empresa_id = despachos_bodega_3pl.empresa_id
        AND v.estado = 'activa'
    )
  );
DROP POLICY IF EXISTS despacho3pl_bodega_preparar ON despachos_bodega_3pl;
CREATE POLICY despacho3pl_bodega_preparar ON despachos_bodega_3pl FOR UPDATE TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
    AND estado = 'pendiente'
  )
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
    AND estado = 'preparado'
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v
      WHERE v.bodega_id = despachos_bodega_3pl.bodega_id
        AND v.empresa_id = despachos_bodega_3pl.empresa_id
        AND v.estado = 'activa'
    )
  );

-- Sin bodega_id propio: el ítem se ve si su cabecera se ve (por bodega o por
-- empresa; el EXISTS pasa por la política de la cabecera, que ya exige rol
-- admin_bodega/operario del lado de la bodega: un domiciliario no ve items), y solo se agrega a una cabecera pendiente de la empresa activa.
DROP POLICY IF EXISTS despacho_item3pl_ver ON despacho_items_bodega_3pl;
CREATE POLICY despacho_item3pl_ver ON despacho_items_bodega_3pl FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM despachos_bodega_3pl d WHERE d.id = despacho_id));
DROP POLICY IF EXISTS despacho_item3pl_crear ON despacho_items_bodega_3pl;
CREATE POLICY despacho_item3pl_crear ON despacho_items_bodega_3pl FOR INSERT TO app_user
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM despachos_bodega_3pl d
      WHERE d.id = despacho_id AND d.empresa_id = despacho_items_bodega_3pl.empresa_id AND d.estado = 'pendiente'
    )
  );

-- ---------------------------------------------------------------------
-- Issue #627 (Domi-1, migración 0045) — entregas del domiciliario.
-- · La empresa ve y crea las suyas (solo hacia una bodega ligada ACTIVA y un
--   domiciliario ACTIVO de esa bodega: se comprueba también en WITH CHECK),
--   cambia o quita el domiciliario solo mientras esté 'asignada'.
-- · La bodega ve las de su bodega_id.
-- · El domiciliario (app.bodega_usuario_id, fijado por dbComoBodega con
--   usuarioId) ve SOLO las suyas (cualquier estado: un UPDATE exige que la
--   fila nueva también pase el SELECT, y así tiene historial) y las cierra
--   mientras estén abiertas.
-- · Los datos de quien recibe viven en entregas_domiciliario_contacto: el
--   domiciliario solo los lee mientras la entrega esté abierta
--   (asignada|en_camino) y nunca los escribe. La empresa los conserva.
-- ---------------------------------------------------------------------
ALTER TABLE entregas_domiciliario ENABLE ROW LEVEL SECURITY;
ALTER TABLE entregas_domiciliario FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON entregas_domiciliario TO app_user;
REVOKE UPDATE ON entregas_domiciliario FROM app_user;
GRANT UPDATE (miembro_domiciliario_id, estado, motivo, actualizada_ts) ON entregas_domiciliario TO app_user;
-- Domi-3 (migración 0048): la foto la escribe el domiciliario al cerrar.
GRANT UPDATE (foto_public_id, foto_ts) ON entregas_domiciliario TO app_user;

-- Domi-3: pasar a 'entregada' exige foto. RESTRICTIVE: se suma (AND) a
-- cualquier otra política de UPDATE, así que vale para el domiciliario y
-- para cualquier otro camino. Solo mira la fila NUEVA: las entregadas antes
-- de Domi-3 no se actualizan nunca más (una cerrada no pasa el USING de
-- entrega_domiciliario_cerrar).
DROP POLICY IF EXISTS entrega_entregada_con_foto ON entregas_domiciliario;
CREATE POLICY entrega_entregada_con_foto ON entregas_domiciliario AS RESTRICTIVE FOR UPDATE TO app_user
  USING (true)
  WITH CHECK (estado <> 'entregada' OR foto_public_id IS NOT NULL);

-- El vendedor necesita ver a los domiciliarios ACTIVOS de la bodega que lo
-- atiende (solo vínculo activo). Solo filas de rol domiciliario. NO consulta
-- bodegas_3pl: sus políticas leen miembros_bodega_3pl y se formaría un ciclo
-- ("infinite recursion detected in policy"). Que la bodega esté activa se
-- comprueba en el WITH CHECK de entregas_domiciliario.
DROP POLICY IF EXISTS miembro3pl_ver_domiciliarios_empresa ON miembros_bodega_3pl;
CREATE POLICY miembro3pl_ver_domiciliarios_empresa ON miembros_bodega_3pl FOR SELECT TO app_user
  USING (
    rol = 'domiciliario' AND activo
    AND bodega_id IN (
      SELECT v.bodega_id FROM bodegas_3pl_empresas v
      WHERE v.empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
        AND v.estado = 'activa'
    )
  );

DROP POLICY IF EXISTS entrega_empresa_ver ON entregas_domiciliario;
CREATE POLICY entrega_empresa_ver ON entregas_domiciliario FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);

DROP POLICY IF EXISTS entrega_empresa_crear ON entregas_domiciliario;
CREATE POLICY entrega_empresa_crear ON entregas_domiciliario FOR INSERT TO app_user
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND estado = 'asignada'
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v JOIN bodegas_3pl b ON b.id = v.bodega_id
      WHERE v.bodega_id = entregas_domiciliario.bodega_id AND v.empresa_id = entregas_domiciliario.empresa_id
        AND v.estado = 'activa' AND b.estado = 'activa'
    )
    AND EXISTS (
      SELECT 1 FROM miembros_bodega_3pl m
      WHERE m.id = entregas_domiciliario.miembro_domiciliario_id
        AND m.bodega_id = entregas_domiciliario.bodega_id AND m.rol = 'domiciliario' AND m.activo
    )
  );

-- Reasignar: solo mientras esté 'asignada' (si ya va en camino, no se le
-- quita al domiciliario), y el nuevo domiciliario cumple lo mismo que al crear.
DROP POLICY IF EXISTS entrega_empresa_reasignar ON entregas_domiciliario;
CREATE POLICY entrega_empresa_reasignar ON entregas_domiciliario FOR UPDATE TO app_user
  USING (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND estado = 'asignada'
  )
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND estado = 'asignada'
    AND EXISTS (
      SELECT 1 FROM bodegas_3pl_empresas v JOIN bodegas_3pl b ON b.id = v.bodega_id
      WHERE v.bodega_id = entregas_domiciliario.bodega_id AND v.empresa_id = entregas_domiciliario.empresa_id
        AND v.estado = 'activa' AND b.estado = 'activa'
    )
    AND EXISTS (
      SELECT 1 FROM miembros_bodega_3pl m
      WHERE m.id = entregas_domiciliario.miembro_domiciliario_id
        AND m.bodega_id = entregas_domiciliario.bodega_id AND m.rol = 'domiciliario' AND m.activo
    )
  );

DROP POLICY IF EXISTS entrega_empresa_quitar ON entregas_domiciliario;
CREATE POLICY entrega_empresa_quitar ON entregas_domiciliario FOR DELETE TO app_user
  USING (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND estado = 'asignada'
  );

DROP POLICY IF EXISTS entrega_bodega_ver ON entregas_domiciliario;
CREATE POLICY entrega_bodega_ver ON entregas_domiciliario FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    -- dbComoBodega fija app.bodega_id también para el domiciliario: sin esta
    -- condición vería todas las entregas de su bodega (OR de políticas).
    AND current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
  );

-- Domiciliario: miembro ACTIVO y rol domiciliario de la bodega activa, que
-- además es la persona de la sesión (app.bodega_usuario_id).
DROP POLICY IF EXISTS entrega_domiciliario_ver ON entregas_domiciliario;
CREATE POLICY entrega_domiciliario_ver ON entregas_domiciliario FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'domiciliario'
    AND miembro_domiciliario_id IN (
      SELECT m.id FROM miembros_bodega_3pl m
      WHERE m.usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
        AND m.bodega_id = entregas_domiciliario.bodega_id AND m.rol = 'domiciliario' AND m.activo
    )
  );
DROP POLICY IF EXISTS entrega_domiciliario_cerrar ON entregas_domiciliario;
CREATE POLICY entrega_domiciliario_cerrar ON entregas_domiciliario FOR UPDATE TO app_user
  USING (
    estado IN ('asignada', 'en_camino')
    AND bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'domiciliario'
    AND miembro_domiciliario_id IN (
      SELECT m.id FROM miembros_bodega_3pl m
      WHERE m.usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
        AND m.bodega_id = entregas_domiciliario.bodega_id AND m.rol = 'domiciliario' AND m.activo
    )
  )
  WITH CHECK (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) = 'domiciliario'
    AND miembro_domiciliario_id IN (
      SELECT m.id FROM miembros_bodega_3pl m
      WHERE m.usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
        AND m.bodega_id = entregas_domiciliario.bodega_id AND m.rol = 'domiciliario' AND m.activo
    )
  );

-- Contacto de la entrega (datos del comprador). Solo la empresa escribe.
ALTER TABLE entregas_domiciliario_contacto ENABLE ROW LEVEL SECURITY;
ALTER TABLE entregas_domiciliario_contacto FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON entregas_domiciliario_contacto TO app_user;
REVOKE UPDATE ON entregas_domiciliario_contacto FROM app_user;
GRANT UPDATE (receptor_nombre, direccion, barrio, ciudad, telefono, nota) ON entregas_domiciliario_contacto TO app_user;

DROP POLICY IF EXISTS contacto_empresa_ver ON entregas_domiciliario_contacto;
CREATE POLICY contacto_empresa_ver ON entregas_domiciliario_contacto FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);

DROP POLICY IF EXISTS contacto_empresa_crear ON entregas_domiciliario_contacto;
CREATE POLICY contacto_empresa_crear ON entregas_domiciliario_contacto FOR INSERT TO app_user
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND EXISTS (SELECT 1 FROM entregas_domiciliario e WHERE e.id = entregas_domiciliario_contacto.entrega_id)
  );

DROP POLICY IF EXISTS contacto_empresa_editar ON entregas_domiciliario_contacto;
CREATE POLICY contacto_empresa_editar ON entregas_domiciliario_contacto FOR UPDATE TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid)
  WITH CHECK (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);

DROP POLICY IF EXISTS contacto_empresa_borrar ON entregas_domiciliario_contacto;
CREATE POLICY contacto_empresa_borrar ON entregas_domiciliario_contacto FOR DELETE TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);

-- Bodega (admin_bodega u operario): solo si la entrega es de su bodega.
DROP POLICY IF EXISTS contacto_bodega_ver ON entregas_domiciliario_contacto;
CREATE POLICY contacto_bodega_ver ON entregas_domiciliario_contacto FOR SELECT TO app_user
  USING (
    current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
    AND EXISTS (
      SELECT 1 FROM entregas_domiciliario e
      WHERE e.id = entregas_domiciliario_contacto.entrega_id
        AND e.bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    )
  );

-- Domiciliario: solo si la entrega es SUYA y sigue ABIERTA. El EXISTS pasa
-- por entrega_domiciliario_ver (la cabecera), que ya exige miembro activo.
DROP POLICY IF EXISTS contacto_domiciliario_ver ON entregas_domiciliario_contacto;
CREATE POLICY contacto_domiciliario_ver ON entregas_domiciliario_contacto FOR SELECT TO app_user
  USING (
    current_setting('app.bodega_rol', true) = 'domiciliario'
    AND EXISTS (
      SELECT 1 FROM entregas_domiciliario e
      WHERE e.id = entregas_domiciliario_contacto.entrega_id
        AND e.estado IN ('asignada', 'en_camino')
    )
  );

-- ---------------------------------------------------------------------
-- Domi-4 (migración 0049) — novedades de una entrega, sin cerrarla.
-- · Solo se AGREGAN: app_user tiene SELECT e INSERT, nunca UPDATE ni
--   DELETE (historial; se van solas si se borra la entrega).
-- · Crea: solo el domiciliario dueño de la entrega, mientras siga ABIERTA,
--   a su nombre y con la misma empresa y bodega de la entrega. El EXISTS
--   pasa por entrega_domiciliario_ver, que ya exige que sea suya y activo.
-- · Ven: la empresa (las suyas), la bodega (admin/operario, las de su
--   bodega) y el domiciliario (las de sus entregas abiertas).
-- ---------------------------------------------------------------------
ALTER TABLE entregas_novedades ENABLE ROW LEVEL SECURITY;
ALTER TABLE entregas_novedades FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON entregas_novedades TO app_user;
REVOKE UPDATE, DELETE ON entregas_novedades FROM app_user;

DROP POLICY IF EXISTS novedad_empresa_ver ON entregas_novedades;
CREATE POLICY novedad_empresa_ver ON entregas_novedades FOR SELECT TO app_user
  USING (empresa_id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid);

DROP POLICY IF EXISTS novedad_bodega_ver ON entregas_novedades;
CREATE POLICY novedad_bodega_ver ON entregas_novedades FOR SELECT TO app_user
  USING (
    bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND current_setting('app.bodega_rol', true) IN ('admin_bodega', 'operario')
  );

DROP POLICY IF EXISTS novedad_domiciliario_ver ON entregas_novedades;
CREATE POLICY novedad_domiciliario_ver ON entregas_novedades FOR SELECT TO app_user
  USING (
    current_setting('app.bodega_rol', true) = 'domiciliario'
    AND EXISTS (
      SELECT 1 FROM entregas_domiciliario e
      WHERE e.id = entregas_novedades.entrega_id
        AND e.estado IN ('asignada', 'en_camino')
    )
  );

DROP POLICY IF EXISTS novedad_domiciliario_crear ON entregas_novedades;
CREATE POLICY novedad_domiciliario_crear ON entregas_novedades FOR INSERT TO app_user
  WITH CHECK (
    current_setting('app.bodega_rol', true) = 'domiciliario'
    AND usuario_id = NULLIF(current_setting('app.bodega_usuario_id', true), '')::uuid
    AND bodega_id = NULLIF(current_setting('app.bodega_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM entregas_domiciliario e
      WHERE e.id = entregas_novedades.entrega_id
        AND e.empresa_id = entregas_novedades.empresa_id
        AND e.bodega_id = entregas_novedades.bodega_id
        AND e.estado IN ('asignada', 'en_camino')
    )
  );

-- ---------------------------------------------------------------------
-- Anuncios de la plataforma (25-nov, migración 0050).
-- · superadmin_user: ve todos, crea, y solo puede escribir retirado_ts
--   (retirar). Nunca borra ni edita el texto: historial.
-- · app_user (panel del vendedor): solo LEE los vigentes — ya empezaron,
--   no vencieron y no se retiraron. No escribe nada.
-- ---------------------------------------------------------------------
ALTER TABLE anuncios_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE anuncios_plataforma FORCE ROW LEVEL SECURITY;
REVOKE ALL ON anuncios_plataforma FROM PUBLIC;
GRANT SELECT, INSERT ON anuncios_plataforma TO superadmin_user;
GRANT UPDATE (retirado_ts) ON anuncios_plataforma TO superadmin_user;
GRANT SELECT ON anuncios_plataforma TO app_user;

DROP POLICY IF EXISTS anuncio_superadmin_ver ON anuncios_plataforma;
CREATE POLICY anuncio_superadmin_ver ON anuncios_plataforma FOR SELECT TO superadmin_user USING (true);
DROP POLICY IF EXISTS anuncio_superadmin_crear ON anuncios_plataforma;
CREATE POLICY anuncio_superadmin_crear ON anuncios_plataforma FOR INSERT TO superadmin_user WITH CHECK (retirado_ts IS NULL);
-- Retirar una sola vez: una fila ya retirada no se vuelve a tocar.
DROP POLICY IF EXISTS anuncio_superadmin_retirar ON anuncios_plataforma;
CREATE POLICY anuncio_superadmin_retirar ON anuncios_plataforma FOR UPDATE TO superadmin_user
  USING (retirado_ts IS NULL) WITH CHECK (retirado_ts IS NOT NULL);

DROP POLICY IF EXISTS anuncio_vendedor_ver_vigentes ON anuncios_plataforma;
CREATE POLICY anuncio_vendedor_ver_vigentes ON anuncios_plataforma FOR SELECT TO app_user
  USING (retirado_ts IS NULL AND inicio_ts <= now() AND (fin_ts IS NULL OR fin_ts > now()));

-- ---------------------------------------------------------------------
-- Empresas inactivas (25-nov, migración 0051) — último ingreso al panel.
-- app_user NO tiene UPDATE sobre empresas.ultimo_ingreso_ts: lo escribe esta
-- función, y solo en la empresa de la sesión (app.empresa_actual, que fija
-- dbComoEmpresa después de comprobar la membresía). Como mucho una vez por
-- hora: el resto de llamadas no escribe nada. superadmin_user ya lee
-- empresas (GRANT SELECT de arriba).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_ingreso_empresa()
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  UPDATE empresas SET ultimo_ingreso_ts = now()
  WHERE id = NULLIF(current_setting('app.empresa_actual', true), '')::uuid
    AND (ultimo_ingreso_ts IS NULL OR ultimo_ingreso_ts < now() - interval '1 hour')
$fn$;
REVOKE ALL ON FUNCTION registrar_ingreso_empresa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_ingreso_empresa() TO app_user;
