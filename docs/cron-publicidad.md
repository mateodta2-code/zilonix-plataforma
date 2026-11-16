# Cron de Product Ads (issue #254)

`POST /api/trabajos/publicidad` (`app/api/trabajos/publicidad/route.ts`) sincroniza las cuentas conectadas que entren en el presupuesto de la corrida (240 segundos, por debajo del `--max-time 300` del curl). El orden es la última sincronización más vieja; las que nunca corrieron van primero. La respuesta trae `pendientes` (cuentas que no alcanzaron a entrar) y `sigue` (hay que llamar otra vez: backfill a medias, corte que avanzó, o `pendientes` distinto de 0). El workflow encadena tandas mientras `sigue` sea true. Lee Product Ads con el OAuth de cada vendedor y guarda anunciante, campañas, métricas diarias, anuncios y el costo vigente del ítem. No escribe campañas en Mercado Libre. Una cuenta que ya terminó `ok` hace menos de 20 horas se salta sin llamar a Mercado Libre.

Lo llama un cron, sin sesión de Clerk. La puerta es `PUBLICIDAD_TRABAJADOR_SECRET` en la cabecera `x-publicidad-trabajador-secret`, comparada con `crypto.timingSafeEqual`. La conexión de base es `DATABASE_URL_PUBLICIDAD` (`publicidad_trabajador_user`, creado en `db/rls-setup.sql`): solo puede listar `id`, `empresa_id`, `desconectada_ts` y `creado_ts` de `cuentas_ml`, y leer `publicidad_sincronizaciones`. El token y las escrituras pasan por `dbComoEmpresa` / `app_user`.

En staging, el deploy de `main` aplica las migraciones y `db/rls-setup.sql` (`scripts/migrar-al-desplegar.mjs`). Si el rol `publicidad_trabajador_user` todavía no existe, el deploy se detiene: los roles se crean una sola vez a mano, con contraseña real, por el túnel privado. Después carga en Railway `DATABASE_URL_PUBLICIDAD` y `PUBLICIDAD_TRABAJADOR_SECRET`. El secreto de GitHub Actions para staging ya existe: `PUBLICIDAD_TRABAJADOR_SECRET_STAGING`. Tiene que ser el mismo valor que `PUBLICIDAD_TRABAJADOR_SECRET` de Railway en staging. En producción, Mateo aplica la migración y `db/rls-setup.sql` a mano, en el release por la rama `produccion`; el secreto, cuando toque, se llama `PUBLICIDAD_TRABAJADOR_SECRET_PRODUCCION`. Nunca el valor en un chat, un commit o este documento.

## Horario

`.github/workflows/sincronizar-publicidad.yml` corre cada hora (`0 * * * *`) con hasta 8 tandas de 240 segundos, para que el backfill no espere al día siguiente. `workflow_dispatch` ("Run workflow") usa el mismo endpoint y encadena hasta 36 tandas (~3 horas): es la forma de cerrar un mes (octubre 1-31 entra en los 62 días) en una sola corrida, después de que staging haya desplegado este cambio. Una segunda corrida no se superpone (`concurrency`). Las métricas de la API se refrescan cerca de las 10:00 GMT-3, así que el total del día puede ir atrasado respecto de la Central de vendedores. La primera vez pide 62 días en tramos de 7, y cada tanda retoma donde quedó (`reanudaDesde`). Un `ok` de cuenta sin Product Ads o sin permiso de la app no cierra el backfill: `cierra_backfill` queda en false y, pasadas 20 horas, se vuelve a preguntar. Después de un tramo `ok` con `cierra_backfill`, las siguientes piden los últimos 15 días (14 de atribución más uno), como mucho una vez cada 20 horas.

## Qué hace falta para que corra en staging

1. Al mergear a `main`, el deploy de staging aplica la migración de Drizzle y `db/rls-setup.sql`. Revisa los logs: `[migrar-al-desplegar] Listo.`
2. Si el deploy dice que falta `publicidad_trabajador_user`, créalo una vez a mano (el script no usa la contraseña de ejemplo) y vuelve a desplegar. Si el rol ya existe, este paso no hace falta. El rol, cuando existe, tiene: `CONNECT`, `USAGE` en `public`, `SELECT (id, empresa_id, desconectada_ts, creado_ts)` sobre `cuentas_ml`, `SELECT` sobre `publicidad_sincronizaciones`, y las dos políticas de lectura. No puede leer tokens ni escribir.
3. En Railway, staging: `DATABASE_URL_PUBLICIDAD` (ese usuario) y `PUBLICIDAD_TRABAJADOR_SECRET`.
4. El secreto de GitHub `PUBLICIDAD_TRABAJADOR_SECRET_STAGING` ya existe. El workflow de staging lo usa. El valor tiene que coincidir con `PUBLICIDAD_TRABAJADOR_SECRET` de Railway. No pegarlo en ningún otro lado.
5. El permiso "Publicidad de un producto" ya está en la app Zilonix Plataforma (lectura y escritura) y MTTIENDA se reconectó en Seller. Esta fase no escribe campañas aunque el permiso lo permita. Lo que falta es la prueba en staging: totales contra la Central, la forma de `aggregation_type=DAILY` y la ruta `/advertising/...`. Staging y producción comparten la app: esa cuenta no se conecta en los dos a la vez (`docs/publicidad/entornos.md`).

Producción no cambia: Mateo aplica la migración y `db/rls-setup.sql` a mano, en el release por la rama `produccion`, con su propio Postgres y su propio secreto (`PUBLICIDAD_TRABAJADOR_SECRET_PRODUCCION`). El workflow de producción sigue comentado en el archivo del cron.

## Qué no hacer

- No llamar a este endpoint con un `--max-time` menor a unos minutos: un tramo con muchas campañas y anuncios puede tardar.
- No pegar el secreto en el comando que queda en el historial de la shell.
- Una corrida con la anterior ya `ok` hace menos de 20 horas se salta, sin llamar a Mercado Libre. Una corrida `parcial`, o un corte de tiempo que avanzó el día, no se salta: el workflow la retoma en la tanda siguiente.
