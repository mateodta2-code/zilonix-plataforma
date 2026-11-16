# Migraciones — detalle

Léelo antes de generar o aplicar una migración de Drizzle. La regla corta está en `CLAUDE.md`.

- **Ya no hay turnos.** Cualquiera puede mergear un PR con migración cuando el CI esté verde.
- **Antes de mergear**, actualiza la rama con `main` (`git merge origin/main`). Si el número de tu migración ya está ocupado, o el CI marca números repetidos o un `when` fuera de orden, borra tu migración y vuélvela a generar con drizzle-kit (`npm run db:generate`) sobre el `main` actualizado. Nunca renumeres ni edites a mano un archivo de migración ya generado (bug real: colisión de numeración entre dos ramas, documentada en `docs/ESTADO.md`).
- **Al mergear a `main`**, el deploy de staging aplica la migración sola junto con `db/rls-setup.sql` (`scripts/migrar-al-desplegar.mjs`, ya configurado y verificado en Railway staging). Revisa los logs del deploy: `[migrar-al-desplegar] Listo.` Detalle: `docs/migraciones-al-desplegar.md`.
- **Nunca pongas `COMMIT` dentro de una migración.** El migrador ya envuelve la corrida en una transacción; un `COMMIT` propio la corta. Evita borrar o renombrar columnas que la versión anterior aún usa: hazlo en dos pasos (primero deja de usarlas en el código, y en una migración posterior bórralas o renómbralas, cuando esa versión ya no esté en marcha).
- `npm run db:generate` genera una migración después de cambiar `db/schema.ts` — nunca se escribe un archivo de migración a mano.
- `npm run db:migrate` aplica migraciones pendientes contra `DATABASE_URL` (el superusuario que da Railway). Nunca se usa para una consulta de negocio. En staging no lo corras a mano: lo hace el deploy.
- **Producción no cambia.** Allí las migraciones de Drizzle y `db/rls-setup.sql` no se aplican solas con el deploy. Las aplica a mano solo Mateo, en el release por la rama `produccion`, por un túnel privado (`railway connect <servicio-postgres> --tunnel-only`), nunca exponiendo la base a internet.
- Cada cambio de tablas va en una migración versionada (Drizzle) — nunca un `CREATE TABLE IF NOT EXISTS` suelto dentro de una ruta.
