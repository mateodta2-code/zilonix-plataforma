-- Issue #422 (fase 4 de Finanzas) — categorías base de gastos para cada
-- empresa que ya existía. Las empresas nuevas las reciben al crearse
-- (lib/empresas.ts → CATEGORIAS_GASTO_BASE). Misma lista en los dos
-- lados: lib/finanzas/gastos-categorias.test.ts la compara contra este
-- archivo. ON CONFLICT: idempotente si alguien la corre dos veces.
INSERT INTO categorias_gasto (empresa_id, nombre)
SELECT e.id, c.nombre
FROM empresas e
CROSS JOIN (VALUES
  ('Arriendo'),
  ('Nómina'),
  ('Empaques'),
  ('Contador'),
  ('Agencias y transportadoras'),
  ('Flex y domiciliarios'),
  ('Publicidad externa'),
  ('Servicios públicos'),
  ('Software y suscripciones'),
  ('Otros')
) AS c(nombre)
ON CONFLICT ON CONSTRAINT categorias_gasto_empresa_nombre_unico DO NOTHING;
