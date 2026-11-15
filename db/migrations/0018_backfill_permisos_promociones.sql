-- Code review real (Refs #44) — evidencia real contra Postgres en CI:
-- "ERROR: unsafe use of new value 'aprobar' of enum type accion...
-- HINT: New enum values must be committed before they can be used."
-- drizzle-orm mete TODAS las migraciones pendientes de una corrida en
-- UNA sola transacción (ver node_modules/drizzle-orm/pg-core/dialect.js,
-- session.transaction envolviendo el for de TODO el lote) — en una
-- base recién creada (como la de CI, que aplica 0001..0018 de una)
-- eso significa que el ALTER TYPE ... ADD VALUE 'aprobar'/'ejecutar'
-- de la migración 0017 todavía no está confirmado cuando esta
-- migración intenta usar esos valores más abajo. Este COMMIT fuerza
-- el corte real de transacción antes de usarlos — es inofensivo en un
-- deploy normal (donde la 0017 ya se aplicó y confirmó hace tiempo,
-- sin este problema) y también lo es acá mismo: un COMMIT sin
-- transacción abierta es un no-op documentado de Postgres (NOTICE,
-- nunca ERROR), así que el COMMIT final que agrega drizzle al
-- terminar la corrida tampoco rompe nada.
COMMIT;
--> statement-breakpoint
-- backfill permisos promociones (Refs #44)
INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', 'consultar'::accion, 'todo'::alcance
FROM roles r
WHERE r.nombre = 'Operador'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = 'consultar'
  );
--> statement-breakpoint
INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', a.accion, 'todo'::alcance
FROM roles r
CROSS JOIN (
  SELECT unnest(ARRAY['consultar', 'aprobar', 'ejecutar']::accion[]) AS accion
) a
WHERE r.nombre = 'Gerente'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = a.accion
  );
--> statement-breakpoint
INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', a.accion, 'todo'::alcance
FROM roles r
CROSS JOIN (
  SELECT unnest(ARRAY['consultar', 'crear', 'modificar', 'anular', 'autorizar', 'aprobar', 'ejecutar']::accion[]) AS accion
) a
WHERE r.nombre = 'Dueño'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = a.accion
  );
