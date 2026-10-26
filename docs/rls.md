# Seguridad por fila (RLS) — tarea 1.3

Explicado simple: aunque un pedazo de código se olvide de filtrar "solo lo de esta empresa", **la base de datos misma** se niega a devolver filas de otra empresa. No depende de que el programador (o la IA) nunca se equivoque — la protección vive un nivel más abajo, en Postgres.

## Cómo funciona, en 3 piezas

1. **Un usuario de base de datos aparte, con permisos limitados.** Railway te da un usuario con poder total (puede ver y cambiar cualquier cosa, saltándose cualquier regla). Ese usuario **ya no lo usa la app** para el día a día — queda reservado solo para crear/cambiar tablas (migraciones). La app usa un usuario nuevo, `app_user`, que NO puede saltarse las reglas de seguridad.

2. **Cada tabla de negocio tiene una regla: "solo mostrar lo de la empresa activa".** Esa regla vive en Postgres, no en el código de la app.

3. **La app le dice a Postgres cuál es "la empresa activa" al empezar cada operación**, y esa marca se borra sola al terminar — nunca se queda pegada por accidente a la siguiente petición (eso sería un error gravísimo, es justo lo que se evitó a propósito).

## Qué pasa si alguien se olvida de fijar la empresa activa

Confirmado en vivo (prueba de aislamiento, tarea 1.4): si una consulta pasa por la conexión segura **sin** pasar por `dbComoEmpresa()`, Postgres no dice "no hay nada" en silencio — la consulta directamente **falla con un error**. Es a propósito más estricto que "cero resultados": un error se nota de inmediato (se cae la pantalla, salta en los logs); "cero resultados" se puede confundir con "esta empresa no tiene datos todavía" y pasar desapercibido mucho tiempo. Un error ruidoso es la forma más segura de fallar acá.

## Quinto usuario: el cron de Product Ads (issue #254)

`publicidad_trabajador_user` (`DATABASE_URL_PUBLICIDAD`) lista las cuentas conectadas de cualquier empresa para saber a cuál sincronizar. El GRANT de `cuentas_ml` es solo `id`, `empresa_id`, `desconectada_ts` y `creado_ts`: no puede leer los tokens. También puede leer `publicidad_sincronizaciones`. No puede escribir. El token y las filas de campañas, métricas y costos se leen y se escriben con `app_user` dentro de `dbComoEmpresa`, cuando ya se sabe la empresa.

Ese rol se crea en `db/rls-setup.sql` (placeholder `PONE_ACA_UNA_QUINTA_CONTRASEÑA_REAL`). No viaja en la migración de Drizzle. Hay que correr el script a mano, por el túnel, en cada ambiente, y cargar la URL en Railway. La contraseña no se pega en un chat ni en un commit.

Las seis tablas de publicidad tienen la misma política de aislamiento que el resto: `empresa_id` igual a `app.empresa_actual`. La prueba es `db/rls-publicidad.test.ts`.

## Estado — ya corrido contra la base real

Este mecanismo ya está escrito en el código (`db/rls-setup.sql`, `db/empresa-context.ts`, `db/index.ts`) y ya se corrió contra la base real de Railway (Cowork, 14/10/2026) — `app_user` creado, RLS activa y forzada en las 6 tablas, `DATABASE_URL_APP` configurada. La prueba automática (`db/rls.test.ts`, tarea 1.4) confirma el aislamiento real en cada Pull Request.

### Instrucciones para Cowork (referencia — ya se corrieron una vez; sirven de nuevo si se rearma la base desde cero)

1. Abrir el túnel privado a la base (ver `README.md`, sección de migraciones).
2. Conectarse con `psql` a la URL que imprime el túnel.
3. Abrir el archivo `db/rls-setup.sql` del repo, **reemplazar** `PONE_ACA_UNA_CONTRASEÑA_REAL` por una contraseña real elegida ahí mismo (no reusar ninguna otra contraseña del proyecto).
4. Pegar el script completo ya editado en `psql` y correrlo.
5. Armar la nueva URL de conexión reemplazando usuario y contraseña en la `DATABASE_URL` normal:
   - Antes: `postgresql://postgres:CLAVE_VIEJA@host:puerto/railway`
   - Después: `postgresql://app_user:LA_CONTRASEÑA_QUE_ELEGISTE@host:puerto/railway`
6. En Railway → proyecto `zilonix-plataforma` → servicio `web` → Variables: agregar `DATABASE_URL_APP` con esa URL nueva.
7. Avisar — confirmo que el servicio sigue funcionando con la nueva conexión.

**Importante:** la contraseña de `app_user` no se pega en ningún chat ni se le pasa a Claude Code en ningún momento — se queda solo en el script ya editado (que no se sube a git, `db/rls-setup.sql` se mantiene con el placeholder) y en la variable de Railway.
