# Changelog — Zilonix Plataforma

Registro de cada entrega a producción, con la versión y qué tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) la generó. Nada pasa a producción sin pasar por staging primero.

## v0.1.0

- **2026-10-14** — Tarea 1.1 (Repositorio nuevo): Next.js 14 + TypeScript, Drizzle ORM + Postgres, GitHub Actions (compila, tipos, pruebas, build en cada PR), página `/api/version`, desplegado en Railway. Sentry se deja fuera del alcance por ahora, para no sumar una integración a medias.
- **2026-10-14** — Tarea 1.2 (Modelo de datos base): 7 tablas (empresas, usuarios, roles, membresías, permisos_rol, invitaciones, auditoría), diseño en `docs/modelo-datos.md` aprobado por Mateo antes de construir. Primera migración generada y aplicada contra la base real de Railway (vía túnel privado de Railway, sin exponer la base a internet en ningún momento).
- **2026-10-14** — Tarea 1.3 (Seguridad por fila): mecanismo completo — usuario de base restringido (`app_user`, sin privilegios de superusuario), RLS forzada en las 6 tablas de negocio (todas menos `usuarios`, que no tiene una sola empresa dueña), variable de sesión `app.empresa_actual` fijada por transacción (nunca con un `SET` que pueda filtrarse a otra petición por el pool de conexiones). Decisión D8: el acceso de superadmin a cifras agregadas de negocio es un mecanismo aparte, tarea 1.11. Ya corrido de verdad contra la base real de Railway (confirmado por Cowork: `app_user` creado, RLS activa, `DATABASE_URL_APP` configurada).
- **2026-10-14** — Tarea 1.4 (Prueba de aislamiento): `db/rls.test.ts` crea dos empresas reales y confirma, contra Postgres de verdad (no un mock — RLS no se puede simular), que una empresa nunca puede leer, editar ni borrar las filas de otra, en dos tablas con dos patrones de política distintos (`empresas`, por id propio; `roles`/`membresias`, por `empresa_id`). El CI ahora levanta su propio Postgres efímero en cada PR, aplica las migraciones y el script de RLS, y corre esta prueba — ya no basta con que el build compile, tiene que demostrar el aislamiento real.

