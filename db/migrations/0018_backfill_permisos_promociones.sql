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
