# Multiempresa y RLS — detalle

Movido desde `CLAUDE.md` (issue #320, ahorro de créditos) — léelo antes de tocar cualquier tabla nueva. La regla corta que queda en `CLAUDE.md` es: toda tabla con `empresa_id` usa RLS real, nunca solo código.

1. **Toda tabla con datos de una empresa tiene una columna `empresa_id`** y una política de RLS (`db/rls-setup.sql`) que compara esa columna contra `current_setting('app.empresa_actual')`.
2. **La aplicación nunca se conecta a Postgres con el superusuario.** Hay tres usuarios de base RESTRINGIDOS, cada uno más limitado que el anterior, más el superusuario que da Railway (que solo se usa para migraciones, nunca para una consulta de negocio):
   - `app_user` (`DATABASE_URL_APP`) — el único que usa el tráfico normal de la app. Respeta RLS siempre.
   - `superadmin_user` (`DATABASE_URL_SUPERADMIN`) — solo lectura de cifras agregadas para el panel `/superadmin`, nunca datos de negocio de una empresa sin acceso temporal explícito.
   - `trabajador_user` (`DATABASE_URL_TRABAJADOR`) — solo puede tocar `avisos_ml`, para el proceso que procesa notificaciones de Mercado Libre.
   - `DATABASE_URL` (el superusuario que da Railway) **solo se usa para correr migraciones** (`npm run db:migrate`), nunca para una consulta de negocio.
3. **Toda consulta de negocio pasa por `dbComoEmpresa(empresaId, fn)`** (`db/empresa-context.ts`) — fija `app.empresa_actual` con `SET LOCAL` dentro de una transacción (nunca un `SET` normal, que se filtraría a otra petición por el pool de conexiones) y recién ahí corre la consulta. Nunca se consulta una tabla de negocio directo con `db` sin pasar por este helper.
4. **Cada PR que agrega o cambia una tabla con `empresa_id` tiene que traer su propia prueba de aislamiento** contra Postgres real (no un mock — RLS no se puede simular): crear dos empresas, confirmar que una nunca ve, edita ni borra una fila de la otra.
5. **Los permisos dentro de una empresa son una capa aparte**, por encima de RLS: `requierePermiso(usuarioId, empresaId, modulo, accion)` (`lib/permisos.ts`) es la única función que toda ruta de negocio debe llamar antes de leer o escribir algo — `scripts/verificar-permisos.test.ts` hace fallar el CI si una ruta nueva de `app/` no está clasificada como protegida (y de verdad la llama), exenta (con el motivo escrito) o de superadmin.
