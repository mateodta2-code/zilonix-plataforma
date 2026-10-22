## Issue que referencia

Refs #

<!-- En este repo no se usa Closes. El issue se referencia con Refs y se cierra a mano, después de verificar en staging. -->

## Qué cambia

<!-- Resumen concreto de este pull request. -->

## Cómo se probó

- [ ] Tests (`npm run test`; el CI `build-and-test` tiene que quedar en verde)
- [ ] Staging (verificar el deploy antes de dar la tarea por cerrada, si este pull request cambia comportamiento)
- [ ] Curls, si toca rutas (comando y código de respuesta; nunca secretos, valores ni cadenas de conexión)

## Migración

<!-- Si hubo cambio de tablas: el número de la migración generada con `npm run db:generate`. Nunca escrita a mano. -->

- [ ] No
- [ ] Sí — número:

## Rutas nuevas

<!-- Toda página, route handler o action nueva queda clasificada en `scripts/verificar-permisos.test.ts`: protegida (llama `requierePermiso`), de superadmin (llama `requiereSuperadmin`) o exenta (con el motivo escrito). -->

- [ ] Clasificadas en `scripts/verificar-permisos.test.ts`
- [ ] No aplica

## Changelog

<!-- Un archivo `docs/changelog/pendientes/<rama>.md` con las líneas de este pull request. No editar `docs/CHANGELOG.md` acá: los fragmentos se juntan en el release. -->

- [ ] Fragmento en `docs/changelog/pendientes/`

## Secretos

- [ ] sin secretos ni valores en el diff
