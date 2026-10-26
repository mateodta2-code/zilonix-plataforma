# Cron de la revisión diaria de seguimientos (issue #175)

`POST /api/trabajos/seguimiento` (`app/api/trabajos/seguimiento/route.ts`) procesa UN LOTE (hasta 50 seguimientos — `TAMAÑO_LOTE`, `lib/trabajos/revisionDiariaSeguimiento.ts`) de los seguimientos pendientes de hoy por llamada, nunca todos de una sola corrida: guarda la foto del día de cada uno y genera las alertas correspondientes. No se dispara solo — algo tiene que llamarlo, con el secreto compartido (`SEGUIMIENTO_TRABAJADOR_SECRET`, cabecera `x-seguimiento-trabajador-secret`, comparada con `crypto.timingSafeEqual`).

Como un lote nunca alcanza para todos los seguimientos si una empresa tiene más de 50, hace falta más de una corrida por día — el lote se ordena por `ultima_revision_ts` ASC NULLS FIRST (el que nunca se revisó, o hace más tiempo que no se revisa, entra primero), así que corridas sucesivas SÍ llegan a los que quedaron pendientes de la anterior, nunca repiten siempre los mismos primeros 50.

Mismo criterio que `/api/ml/trabajador` (tarea 2.4, `docs/ESTADO.md`): Railway todavía no tiene el tercer servicio "trabajador de cola" real que pide la decisión D4 del plan técnico — por ahora, un cron externo que llama a este endpoint varias veces al día es honesto con el alcance actual, y se reemplaza por el servicio real cuando el volumen lo justifique.

## Opción ya lista: GitHub Actions

`.github/workflows/revision-diaria-seguimiento.yml` ya está armado, mismo patrón que `trabajador-avisos-ml.yml` — corre contra staging en DOS ventanas por día (issue #250, punto E): madrugada, cada hora de 08:00 a 13:00 UTC (6 corridas; 03:00 a 08:00 en Colombia, UTC-5), y tarde, cada hora de 20:00 a 23:00 UTC (4 corridas; 15:00 a 18:00 en Colombia). El filtro de `obtenerSeguimientosPendientesDeHoy` (`lib/trabajos/revisionDiariaSeguimiento.ts`) ya no es "no revisado hoy" (fecha calendario) sino "no revisado hace menos de 6 horas" — si siguiera siendo por fecha calendario, la ventana de la tarde nunca volvería a tomar lo que la madrugada ya marcó como revisado ese mismo día. Para que funcione hace falta:

1. En GitHub → el repo → **Settings → Secrets and variables → Actions**, crear el secreto `SEGUIMIENTO_TRABAJADOR_SECRET_STAGING` con el mismo valor que la variable de entorno `SEGUIMIENTO_TRABAJADOR_SECRET` de Railway en staging.
2. Cuando se conecten cuentas reales en producción (ver el workflow para el comentario completo), duplicar el workflow apuntando al dominio de producción, con su propio secreto `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION`.

Limitación real de GitHub Actions con `schedule`: no garantiza el minuto exacto (puede atrasarse varios minutos en horas de mucha carga de GitHub) — aceptable para una revisión diaria, no lo sería para algo que necesite el minuto exacto.

## Alternativa: cron nativo de Railway

Railway permite un servicio tipo "Cron Job" (un comando que corre en un horario, sin quedar levantado entre corridas). Si en algún momento se prefiere no depender de GitHub Actions:

1. Crear un nuevo servicio en el proyecto de Railway (**New → Cron Job**, o el servicio `web` existente con un "Cron Schedule" si Railway lo permite en el plan actual — confirmar en el dashboard, puede variar).
2. Comando: `curl -sf -X POST https://<dominio-del-servicio-web>/api/trabajos/seguimiento -H "x-seguimiento-trabajador-secret: $SEGUIMIENTO_TRABAJADOR_SECRET" --max-time 300`.
3. Horario sugerido: `0 8-13 * * *` y `0 20-23 * * *` (mismas dos ventanas que el workflow de GitHub — madrugada y tarde, ver arriba).
4. La variable `SEGUIMIENTO_TRABAJADOR_SECRET` tiene que estar disponible en ESE servicio de cron (puede ser la misma variable compartida del servicio `web`, vía "Shared Variables" de Railway, o una copia — nunca pegada a mano en el comando).

## Alternativa: servicio externo de cron (cron-job.org, EasyCron, etc.)

Si se prefiere no depender de GitHub Actions ni de un servicio nuevo en Railway: cualquier servicio externo que pueda hacer un `POST` HTTPS con una cabecera personalizada en un horario fijo (varias veces al día, ver arriba) sirve igual — apuntando a `https://<dominio>/api/trabajos/seguimiento` con `x-seguimiento-trabajador-secret: <el secreto real>`. El único requisito real es que el servicio soporte HTTPS + cabeceras personalizadas y un timeout de al menos 300s (la mayoría de los gratuitos lo hacen).

## Qué NO hacer

- Nunca pegar el valor real del secreto en este documento, en un commit, ni en un comando de terminal — vive solo en Railway (`SEGUIMIENTO_TRABAJADOR_SECRET`) y, si se usa GitHub Actions, en el secreto de GitHub correspondiente.
- Nunca llamar a este endpoint con un `--max-time` menor a unos minutos: un lote de 50 seguimientos, cada uno con su pausa entre llamadas y sus reintentos en 429, puede tardar varios minutos en terminar — cortarlo a mitad de un lote no rompe nada (cada seguimiento se guarda apenas termina, no al final del lote entero) pero deja el resto del lote sin procesar hasta la próxima corrida.
- Llamar a este endpoint más de lo necesario no rompe nada (un seguimiento revisado hace menos de 6 horas simplemente no vuelve a entrar al lote, ver el filtro en `lib/trabajos/revisionDiariaSeguimiento.ts`), pero tampoco aporta nada una vez que todos los seguimientos activos ya tienen su foto del día — `seguimiento_fotos` sigue con una sola fila por seguimiento por día (índice único), así que una segunda corrida el mismo día que encuentre un seguimiento ya fotografiado hoy lo deja como "saltado", nunca inventa una segunda foto.
