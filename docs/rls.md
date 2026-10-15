# Seguridad por fila (RLS) — tarea 1.3

Explicado simple: aunque un pedazo de código se olvide de filtrar "solo lo de esta empresa", **la base de datos misma** se niega a devolver filas de otra empresa. No depende de que el programador (o la IA) nunca se equivoque — la protección vive un nivel más abajo, en Postgres.

## Cómo funciona, en 3 piezas

1. **Un usuario de base de datos aparte, con permisos limitados.** Railway te da un usuario con poder total (puede ver y cambiar cualquier cosa, saltándose cualquier regla). Ese usuario **ya no lo usa la app** para el día a día — queda reservado solo para crear/cambiar tablas (migraciones). La app usa un usuario nuevo, `app_user`, que NO puede saltarse las reglas de seguridad.

2. **Cada tabla de negocio tiene una regla: "solo mostrar lo de la empresa activa".** Esa regla vive en Postgres, no en el código de la app.

3. **La app le dice a Postgres cuál es "la empresa activa" al empezar cada operación**, y esa marca se borra sola al terminar — nunca se queda pegada por accidente a la siguiente petición (eso sería un error gravísimo, es justo lo que se evitó a propósito).

## Qué falta para que quede activo de verdad

Este mecanismo ya está escrito en el código (`db/rls-setup.sql`, `db/empresa-context.ts`, `db/index.ts`), pero **todavía no se corrió contra la base real** — necesita una contraseña nueva que Claude Code nunca debe ver ni generar.

### Instrucciones para Cowork

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
