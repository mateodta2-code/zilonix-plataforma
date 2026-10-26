# Cron de Product Ads (issue #254)

`POST /api/trabajos/publicidad` (`app/api/trabajos/publicidad/route.ts`) sincroniza un lote de cuentas conectadas (hasta 5, o hasta ~200 segundos). Lee Product Ads con el OAuth de cada vendedor y guarda anunciante, campañas, métricas diarias, anuncios y el costo vigente del ítem. No escribe campañas en Mercado Libre.

Lo llama un cron, sin sesión de Clerk. La puerta es `PUBLICIDAD_TRABAJADOR_SECRET` en la cabecera `x-publicidad-trabajador-secret`, comparada con `crypto.timingSafeEqual`. La conexión de base es `DATABASE_URL_PUBLICIDAD` (`publicidad_trabajador_user`, creado en `db/rls-setup.sql`): solo puede listar `id`, `empresa_id`, `desconectada_ts` y `creado_ts` de `cuentas_ml`, y leer `publicidad_sincronizaciones`. El token y las escrituras pasan por `dbComoEmpresa` / `app_user`.

`db/rls-setup.sql` no viaja en el deploy. Hay que correrlo a mano, por el túnel privado, en staging y en producción, después de la migración de Drizzle. Recién ahí se cargan en Railway `DATABASE_URL_PUBLICIDAD` y `PUBLICIDAD_TRABAJADOR_SECRET`. Los nombres del secreto en GitHub Actions son `PUBLICIDAD_TRABAJADOR_SECRET_STAGING` y `PUBLICIDAD_TRABAJADOR_SECRET_PRODUCCION`. Nunca el valor en un chat, un commit o este documento.

## Horario

`.github/workflows/sincronizar-publicidad.yml` corre una vez por día a las 14:00 UTC (09:00 en Bogotá, después de las 08:30). Las métricas de la API se refrescan cerca de las 10:00 GMT-3, así que el total del día puede ir atrasado respecto de la Central de vendedores. `workflow_dispatch` sirve para seguir el backfill: la primera vez pide 62 días en tramos de 7, y cada corrida retoma donde quedó. Después de un tramo `ok` que cierra ese historial, las siguientes piden los últimos 15 días (14 de atribución más uno).

## Qué hace falta para que corra en staging

1. Migración de Drizzle aplicada contra el Postgres de staging.
2. `db/rls-setup.sql` corrido a mano (crea `publicidad_trabajador_user` y las políticas).
3. En Railway, staging: `DATABASE_URL_PUBLICIDAD` y `PUBLICIDAD_TRABAJADOR_SECRET`.
4. En GitHub → Settings → Secrets and variables → Actions: `PUBLICIDAD_TRABAJADOR_SECRET_STAGING`, el mismo valor que la variable de Railway. No pegarlo en ningún otro lado.
5. El permiso "Publicidad de un producto" ya está en la app Zilonix Plataforma (lectura y escritura) y MTTIENDA se reconectó en Seller. Lo que falta es la prueba en staging: totales contra la Central, la forma de `aggregation_type=DAILY` y la ruta `/advertising/...`. Una cuenta cuyo token se emitió antes del permiso puede seguir en 403 hasta reconectarla; la pantalla lo dice.

Producción usa los mismos pasos con su propio Postgres, su propio secreto (`PUBLICIDAD_TRABAJADOR_SECRET_PRODUCCION`) y el workflow de producción todavía comentado en el archivo del cron.

## Qué no hacer

- No llamar a este endpoint con un `--max-time` menor a unos minutos: un tramo con muchas campañas y anuncios puede tardar.
- No pegar el secreto en el comando que queda en el historial de la shell.
- Una segunda corrida el mismo día, si la anterior ya terminó `ok`, se salta. Una corrida `parcial` del mismo día no se salta: es el backfill que hay que retomar.
