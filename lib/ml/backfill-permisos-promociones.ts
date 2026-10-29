// La plantilla de un rol se copia una sola vez, al crearlo
// (asegurarRolDeEmpresa). Dueño tampoco se recalcula: lib/empresas.ts
// guarda permisosDeDueno() en filas. Sin este INSERT, las empresas que
// ya existían cuando entró el módulo Promociones (migración 0017,
// mergeado antes de que corriera este backfill) nunca recibieron
// promociones.consultar/aprobar/ejecutar para Dueño/Gerente, ni
// promociones.consultar para Operador — mismo bug real que
// lib/publicidad/backfill-permisos.ts (issue #254), ahora para
// promociones (issue #44 / rama fix-promociones-permisos-dueno).
//
// Corre dentro de la migración, como superusuario: la migración no
// pasa por RLS. El mismo texto se prueba contra app_user con el
// contexto de una empresa, para que no se desfase del archivo SQL.

export const MARCA_BACKFILL_PERMISOS_PROMOCIONES = "backfill permisos promociones (Refs #44)";

export const SQL_BACKFILL_PERMISOS_PROMOCIONES = [
  `INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', 'consultar'::accion, 'todo'::alcance
FROM roles r
WHERE r.nombre = 'Operador'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = 'consultar'
  )`,
  `INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', a.accion, 'todo'::alcance
FROM roles r
CROSS JOIN (
  SELECT unnest(ARRAY['consultar', 'aprobar', 'ejecutar']::accion[]) AS accion
) a
WHERE r.nombre = 'Gerente'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = a.accion
  )`,
  `INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'promociones', a.accion, 'todo'::alcance
FROM roles r
CROSS JOIN (
  SELECT unnest(ARRAY['consultar', 'crear', 'modificar', 'anular', 'autorizar', 'aprobar', 'ejecutar']::accion[]) AS accion
) a
WHERE r.nombre = 'Dueño'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'promociones' AND p.accion = a.accion
  )`,
] as const;
