# Migraciones — detalle

Movido desde `CLAUDE.md` (issue #320, ahorro de créditos) — léelo antes de generar o aplicar una migración de Drizzle. La regla corta que queda en `CLAUDE.md` es: un solo PR con migración pendiente de fusionar a la vez; cada cambio de tablas va en una migración versionada.

- **Turno de migraciones**: antes de abrir un PR nuevo con su propia migración, actualizar la rama contra `main` y volver a correr `npm run db:generate` sobre esa base — nunca renumerar ni editar a mano un archivo de migración ya generado (bug real: colisión de numeración entre dos ramas, documentada en `docs/ESTADO.md`).
- `npm run db:generate` genera una migración después de cambiar `db/schema.ts` — nunca se escribe un archivo de migración a mano.
- `npm run db:migrate` aplica migraciones pendientes contra `DATABASE_URL` (el superusuario que da Railway). Nunca se usa para una consulta de negocio.
- Las migraciones de Drizzle y `db/rls-setup.sql` **no se aplican solas con el deploy** — hay que correrlas a mano contra cada ambiente por un túnel privado (`railway connect <servicio-postgres> --tunnel-only`), nunca exponiendo la base a internet.
- Cada cambio de tablas va en una migración versionada (Drizzle) — nunca un `CREATE TABLE IF NOT EXISTS` suelto dentro de una ruta.
