- **2026-10-28** — Z-FIN-03 (issue #125), base de finanzas fase 1. Refs #125.

  Migración `0012` (generada con `npm run db:generate`, drizzle-kit 0.28.1, el que está en `main`; el #48 sigue abierto y no se subió el kit en este PR). Tablas `titulares`, `configuracion_finanzas` y `metas_mensuales`, con RLS. `cuentas_ml.titular_id` nullable y FK compuesta `(empresa_id, titular_id)` → `titulares(empresa_id, id)` `ON DELETE RESTRICT`. No se tocó `cuentas_ml.estado` (eso es el #59). `auditoria` suma `entidad_id`, `valor_anterior` y `valor_nuevo`, opcionales: `registrarAuditoria` sigue escribiendo igual si no se pasan.

  `app_user` queda con `SELECT, INSERT` sobre `auditoria` y se le hace `REVOKE UPDATE, DELETE`. La pregunta 8 del borrador no está resuelta en el repo (en #124 «pregunta 8» es la de los roles). Se aplicó igual porque es criterio de aceptación, pendiente de confirmación de Sharel/Mateo.

  Sin fila de `configuracion_finanzas`, `leerConfiguracionFinanzas` devuelve null: no se asume 19 % de IVA ni otro default. El `3` de `plazo_vencimiento_dias` es el default de la columna cuando la fila se inserta sin ese campo. Los interruptores de aviso nacen en null. La moneda de `metas_mensuales` nace en `COP` (decisión de Mateo ya escrita en el issue). Mes sin fila = sin meta.

  El documento del titular, el correo y el WhatsApp de avisos se enmascaran antes de entrar a la bitácora (últimos 4 dígitos, o los últimos 4 caracteres del correo). `db/rls-setup.sql` se corre a mano en staging y producción; no viaja con el deploy.
