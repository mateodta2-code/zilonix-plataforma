# Migraciones automáticas al desplegar (solo staging)

Desde este cambio, el deploy del servicio `web` de **staging** puede aplicar solo las migraciones pendientes de Drizzle y luego `db/rls-setup.sql`, sin túnel y sin turno de migración. **Producción no cambia**: ahí las migraciones se siguen aplicando a mano, como dice `docs/release-seguimiento-prod.md`.

## Cómo funciona

El script es `scripts/migrar-al-desplegar.mjs` (también `npm run db:migrar-al-desplegar`). Railway lo corre como *Pre-deploy command*: después del build y antes de arrancar la versión nueva. Si falla, Railway no pone la versión nueva y staging sigue con la anterior, en vez de arrancar con un esquema a medias.

En orden, el script:

1. **Revisa `MIGRAR_AL_DESPLEGAR`.** Si no es exactamente `1`, no hace nada y termina bien (código 0).
2. **Revisa el ambiente.** Si `MIGRAR_AL_DESPLEGAR=1` pero `RAILWAY_ENVIRONMENT_NAME` no es `staging`, no migra y termina con error (código 1), así que el deploy falla. Es a propósito: si alguien pone la variable en producción por error, es mejor un deploy fallido que una migración no revisada en la base real.
3. **Revisa `DATABASE_URL`.** Sin ella, termina con error.
4. **Toma un advisory lock de Postgres.** Si dos deploys arrancan casi a la vez, el segundo espera (hasta 5 minutos) a que el primero termine, en vez de migrar en paralelo.
5. **Aplica las migraciones pendientes** de `db/migrations/` con el migrador de `drizzle-orm`, el mismo de `npm run db:migrate`. Usa la tabla `drizzle.__drizzle_migrations`, así que solo aplica lo que falta; si ya está todo, no hace nada.
6. **Comprueba que existan los 5 roles** que crea `db/rls-setup.sql` (`app_user`, `superadmin_user`, `trabajador_user`, `seguimiento_trabajador_user`, `publicidad_trabajador_user`). Si falta alguno, se detiene con error: el script los crearía con la contraseña de ejemplo `PONE_ACA_...`. Los roles se crean una sola vez y a mano (`docs/rls.md`). En staging ya existen.
7. **Aplica `db/rls-setup.sql` en una sola transacción.** El script es repetible: los roles van dentro de `IF NOT EXISTS`, cada `CREATE POLICY` va después de su `DROP POLICY IF EXISTS`, y los `GRANT`, `REVOKE` y `ENABLE/FORCE ROW LEVEL SECURITY` se pueden correr las veces que sea. Si algo falla, no queda nada a medias.

Los errores se imprimen solo con su mensaje, nunca con la URL de conexión ni el objeto completo.

## Lo que tiene que configurar Mateo en Railway (solo staging)

En el servicio `web` del ambiente **staging**, nunca en producción:

| Qué | Valor | Nota |
|---|---|---|
| Variable `MIGRAR_AL_DESPLEGAR` | `1` | Enciende el script. Sin ella, el deploy sigue igual que hoy. |
| Variable `DATABASE_URL` | Referencia a la `DATABASE_URL` del Postgres de staging (por ejemplo `${{Postgres.DATABASE_URL}}`, con el nombre real del servicio Postgres) | Es el superusuario que ya usa `npm run db:migrate`. Usa la referencia de Railway; no copies el valor a mano ni lo pegues en ningún chat. |
| *Settings → Deploy → Pre-deploy command* | `node scripts/migrar-al-desplegar.mjs` | Se configura en el dashboard del servicio de staging. |
| `RAILWAY_ENVIRONMENT_NAME` | La pone Railway sola | Tiene que valer `staging`. Si el ambiente tiene otro nombre, el deploy falla con un mensaje claro; en ese caso hay que ajustar `AMBIENTES_PERMITIDOS` en el script con un PR. |

¿Por qué no está en `railway.json`? Railway marcó `railway.json` y `railway.toml` como obsoletos y deja de leerlos el 2026-12-01. Además, un archivo en el repo también llegaría a producción con el próximo release. Configurar el Pre-deploy command en el dashboard de staging deja producción fuera por completo, y el script igual se niega a correr fuera de staging.

Nota: `DATABASE_URL` queda disponible también para el proceso de la app en staging. La app no la usa (`db/index.ts` solo lee `DATABASE_URL_APP`), pero conviene saberlo.

## Qué cambia para el equipo

- **El turno de migración deja de hacer falta para staging.** Fusionas tu PR a `main` y el deploy de staging aplica tu migración. La regla «Una migración a la vez» de `CLAUDE.md` se actualiza aparte, cuando Mateo lo apruebe y la configuración de Railway ya esté puesta.
- **Antes de fusionar un PR con migración**, actualiza tu rama con `main`. Si alguien fusionó otra migración antes que tú, vuelve a correr `npm run db:generate` sobre esa base (nunca renumeres a mano).
- **El CI te frena si se te olvida.** El paso *Verificar historial de migraciones* (`scripts/verificar-migraciones.test.ts`) falla si:
  - dos migraciones comparten número;
  - `db/migrations/meta/_journal.json` no coincide con los `.sql`;
  - una migración tiene un `when` menor o igual que la anterior. Esto pasa cuando generas la migración en una rama vieja y otra se fusiona antes. El migrador de Drizzle salta esa migración **sin avisar**, así que el CI lo trata como error.
- El CI también corre `scripts/migrar-al-desplegar.mjs` dos veces seguidas contra su Postgres efímero, para comprobar que las migraciones y `db/rls-setup.sql` se pueden repetir.

## Producción

Nada de esto corre en producción:

- El servicio de producción no tiene Pre-deploy command ni `MIGRAR_AL_DESPLEGAR`.
- Aunque alguien pusiera la variable allí, el script se niega a migrar (el ambiente no es `staging`) y el deploy falla sin tocar la base.

Para producción sigue valiendo el proceso manual por túnel de `docs/release-seguimiento-prod.md`.

## Si un deploy de staging falla en el pre-deploy

1. Abre los logs del deploy en Railway y busca las líneas `[migrar-al-desplegar]`.
2. Si la falla es de la migración, corrige con un PR nuevo (nunca edites una migración ya aplicada en staging). Las migraciones se aplican dentro de una transacción, salvo que el `.sql` tenga su propio `COMMIT` (hoy solo `0018_backfill_permisos_promociones.sql`, que ya está aplicada en staging).
3. Si dice que faltan roles, créalos a mano una vez con `docs/rls.md` y vuelve a desplegar.
