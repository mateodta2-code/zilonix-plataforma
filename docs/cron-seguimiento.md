# Cron de la revisión diaria de seguimientos (issue #175)

`POST /api/trabajos/seguimiento` (`app/api/trabajos/seguimiento/route.ts`) recorre los seguimientos activos de todas las empresas, guarda la foto del día y genera las alertas correspondientes. No se dispara solo — algo tiene que llamarlo una vez al día, con el secreto compartido (`SEGUIMIENTO_TRABAJADOR_SECRET`, cabecera `x-seguimiento-trabajador-secret`, comparada con `crypto.timingSafeEqual`).

Mismo criterio que `/api/ml/trabajador` (tarea 2.4, `docs/ESTADO.md`): Railway todavía no tiene el tercer servicio "trabajador de cola" real que pide la decisión D4 del plan técnico — por ahora, un cron externo que llama a este endpoint una vez al día es honesto con el alcance actual, y se reemplaza por el servicio real cuando el volumen lo justifique.

## Opción ya lista: GitHub Actions

`.github/workflows/revision-diaria-seguimiento.yml` ya está armado, mismo patrón que `trabajador-avisos-ml.yml` — corre todos los días a las 09:00 UTC (04:00 Colombia) contra staging. Para que funcione hace falta:

1. En GitHub → el repo → **Settings → Secrets and variables → Actions**, crear el secreto `SEGUIMIENTO_TRABAJADOR_SECRET_STAGING` con el mismo valor que la variable de entorno `SEGUIMIENTO_TRABAJADOR_SECRET` de Railway en staging.
2. Cuando se conecten cuentas reales en producción (ver el workflow para el comentario completo), duplicar el workflow apuntando al dominio de producción, con su propio secreto `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION`.

Limitación real de GitHub Actions con `schedule`: no garantiza el minuto exacto (puede atrasarse varios minutos en horas de mucha carga de GitHub) — aceptable para una revisión diaria, no lo sería para algo que necesite el minuto exacto.

## Alternativa: cron nativo de Railway

Railway permite un servicio tipo "Cron Job" (un comando que corre en un horario, sin quedar levantado entre corridas). Si en algún momento se prefiere no depender de GitHub Actions:

1. Crear un nuevo servicio en el proyecto de Railway (**New → Cron Job**, o el servicio `web` existente con un "Cron Schedule" si Railway lo permite en el plan actual — confirmar en el dashboard, puede variar).
2. Comando: `curl -sf -X POST https://<dominio-del-servicio-web>/api/trabajos/seguimiento -H "x-seguimiento-trabajador-secret: $SEGUIMIENTO_TRABAJADOR_SECRET" --max-time 120`.
3. Horario sugerido: `0 9 * * *` (mismo que el workflow de GitHub).
4. La variable `SEGUIMIENTO_TRABAJADOR_SECRET` tiene que estar disponible en ESE servicio de cron (puede ser la misma variable compartida del servicio `web`, vía "Shared Variables" de Railway, o una copia — nunca pegada a mano en el comando).

## Alternativa: servicio externo de cron (cron-job.org, EasyCron, etc.)

Si se prefiere no depender de GitHub Actions ni de un servicio nuevo en Railway: cualquier servicio externo que pueda hacer un `POST` HTTPS con una cabecera personalizada en un horario fijo sirve igual — apuntando a `https://<dominio>/api/trabajos/seguimiento` con `x-seguimiento-trabajador-secret: <el secreto real>`. El único requisito real es que el servicio soporte HTTPS + cabeceras personalizadas (la mayoría de los gratuitos lo hacen).

## Qué NO hacer

- Nunca pegar el valor real del secreto en este documento, en un commit, ni en un comando de terminal — vive solo en Railway (`SEGUIMIENTO_TRABAJADOR_SECRET`) y, si se usa GitHub Actions, en el secreto de GitHub correspondiente.
- Nunca llamar a este endpoint más de una vez por día de verdad para la misma empresa — no rompe nada (el índice único `seguimiento_id`+`fecha` evita duplicar la foto, ver `lib/trabajos/revisionDiariaSeguimiento.ts`), pero tampoco aporta nada: la foto ya quedó guardada en la primera corrida del día.
