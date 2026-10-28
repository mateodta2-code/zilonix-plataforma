- **2026-10-24** — issue #207: postmortem real del "Application error" visto en producción al agregar un seguimiento, documentado en `docs/release-seguimiento-prod.md` — sin código, sin migración, sin secretos en el diff.

  **§2.5 reescrita**: el diagnóstico inicial (solo un password mismatch del rol `seguimiento_trabajador_user`) era real pero incompleto. La causa más grave confirmada: `DATABASE_URL_APP` — la variable que usa TODO el tráfico normal de la app, no solo Seguimiento — estaba apuntando al rol restringido `seguimiento_trabajador_user` en vez de a `app_user`. Sumado a eso, las migraciones `0008`–`0010` nunca se habían corrido contra el Postgres de producción, y el rol de seguimiento tampoco existía. Los tres, ya resueltos por Pablo en producción (migraciones aplicadas, rol + 5 políticas RLS creadas, `DATABASE_URL_APP` corregida a `app_user`/`APP_USER_PASSWORD_TEMPORAL`) — confirmado con una empresa de prueba real y el smoke test de "Seguir en Zilonix" (`?agregado=1` real en `web-production-af270`).

  **§2.1 ampliada**: el chequeo de migración pasa de "solo la 0009" a las tres (`0008`/`0009`/`0010`) — `npm run db:migrate` aplica todas las pendientes de una, nunca conviene pensar solo en la última que se tenía en mente.

  **Qué queda** (no es parte de este fragmento, sin cambios de código): el secreto de GitHub `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION` y una corrida de `workflow_dispatch` del batch diario en producción — secciones 3 y 4 del documento, ya existían, no se tocaron.

  **No se tocó**: ningún archivo de código, ninguna migración nueva, `docs/CHANGELOG.md`, la versión de `package.json`.
