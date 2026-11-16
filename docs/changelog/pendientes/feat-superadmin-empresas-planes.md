## Empresas y planes en /superadmin (PR B)

- Migración 0026 (turno de migración): `empresas.plan` ('prueba'|'basico'|'pro'|'empresarial'), `estado` ('activa'|'suspendida'), `suspendida_motivo`, `suspendida_ts`, `notas_internas`, con CHECK. Hay que correrla a mano en staging y volver a correr `db/rls-setup.sql` (UPDATE por columna y función de conteos).
- `/superadmin`: tabla con plan, estado, miembros, cuentas ML/Falabella conectadas y última actividad, buscador y filtros. Solo conteos (función SECURITY DEFINER), nunca filas de negocio.
- `/superadmin/[empresaId]`: cambiar plan, suspender (motivo obligatorio), reactivar y notas internas; cada acción pide confirmación y queda en auditoria.
- Empresa suspendida: sus miembros ven «Tu cuenta está suspendida. Escríbenos a soporte.» y `requierePermiso` les niega todos los módulos.
- Pendiente: los webhooks y trabajadores de una empresa suspendida siguen corriendo.
