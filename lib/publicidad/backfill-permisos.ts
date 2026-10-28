// La plantilla de un rol se copia una sola vez, al crearlo
// (asegurarRolDeEmpresa). Dueño tampoco se recalcula: lib/empresas.ts
// guarda permisosDeDueno() en filas. Sin este INSERT, las empresas que
// ya existían no reciben publicidad.consultar (ni el resto de acciones
// del Dueño) cuando el módulo entra al código.
//
// Corre dentro de la migración, como superusuario: la migración no
// pasa por RLS. El mismo texto se prueba contra app_user con el
// contexto de una empresa, para que no se desfase del archivo SQL.

export const MARCA_BACKFILL_PERMISOS_PUBLICIDAD = "backfill permisos publicidad (issue #254)";

export const SQL_BACKFILL_PERMISOS_PUBLICIDAD = [
  `INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'publicidad', 'consultar'::accion, 'todo'::alcance
FROM roles r
WHERE r.nombre IN ('Gerente', 'Auxiliar', 'Operaciones')
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'publicidad' AND p.accion = 'consultar'
  )`,
  `INSERT INTO permisos_rol (id, rol_id, modulo, accion, alcance)
SELECT gen_random_uuid(), r.id, 'publicidad', a.accion, 'todo'::alcance
FROM roles r
CROSS JOIN (
  SELECT unnest(ARRAY['consultar', 'crear', 'modificar', 'anular', 'autorizar']::accion[]) AS accion
) a
WHERE r.nombre = 'Dueño'
  AND NOT EXISTS (
    SELECT 1 FROM permisos_rol p
    WHERE p.rol_id = r.id AND p.modulo = 'publicidad' AND p.accion = a.accion
  )`,
] as const;
