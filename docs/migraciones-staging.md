# Migraciones automáticas en staging

**Solo staging.** Producción no cambia: allí las migraciones siguen siendo manuales (`npm run db:migrate`) con aprobación de Mateo.

## Flujo
1. Cambias `db/schema.ts` y corres `npm run db:generate` (sube el `.sql` y el `meta/` generados).
2. Antes de abrir/fusionar el PR: **actualiza tu rama con `main`**. Si otra rama ya tomó el mismo número, el CI falla con *"Actualiza tu rama con main y vuelve a generar la migración con npm run db:generate"*.
3. CI verde (`npm run db:verificar` revisa números repetidos y que el journal coincida con los `.sql`).
4. Merge a `main` → Railway despliega staging y, **antes de arrancar la nueva versión**, el pre-deploy corre `npm run db:migrar-staging`: aplica las migraciones pendientes y luego `db/rls-setup.sql` (repetible).
5. Si el pre-deploy falla, el deploy falla y la versión anterior sigue sirviendo. El mensaje (sin URLs ni contraseñas) queda en los logs del deploy.

## Barreras
`scripts/migrar-staging.ts` se niega a correr si `MIGRAR_AL_DESPLEGAR` no vale `staging`, si `RAILWAY_ENVIRONMENT_NAME` contiene "production"/"produccion", o si faltan los roles de base (los 5 de `rls-setup.sql`): no los crea con contraseña de ejemplo; se crean una vez a mano.

## Configuración en Railway (solo staging)
- Variable en el servicio web de staging: `MIGRAR_AL_DESPLEGAR=staging`.
- `DATABASE_URL` (dueño de la base) debe existir en ese mismo servicio.
- Settings > Deploy > Pre-deploy command: `npm run db:migrar-staging`.
- No poner nada de esto en producción.
