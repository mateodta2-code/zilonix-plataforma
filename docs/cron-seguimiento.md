# Cron de la revisión diaria de seguimientos (issue #175)

`POST /api/trabajos/seguimiento` (`app/api/trabajos/seguimiento/route.ts`) procesa UN LOTE (hasta 50 seguimientos — `TAMAÑO_LOTE`, `lib/trabajos/revisionDiariaSeguimiento.ts`) de los seguimientos pendientes por llamada, nunca todos de una sola corrida: guarda la foto de la franja actual de cada uno y genera las alertas correspondientes. No se dispara solo — algo tiene que llamarlo, con el secreto compartido (`SEGUIMIENTO_TRABAJADOR_SECRET`, cabecera `x-seguimiento-trabajador-secret`, comparada con `crypto.timingSafeEqual`).

Como un lote nunca alcanza para todos los seguimientos si una empresa tiene más de 50, hace falta más de una corrida por ventana — el lote se ordena por `ultima_revision_ts` ASC NULLS FIRST (el que nunca se revisó, o hace más tiempo que no se revisa, entra primero), así que corridas sucesivas SÍ llegan a los que quedaron pendientes de la anterior, nunca repiten siempre los mismos primeros 50.

**Issue #244 (decisión de Sharel, 2026-10-25) — "2 fotos al día"**: antes había UNA sola pasada diaria; ahora son DOS, una por franja ("manana"/"tarde", `lib/seguimiento/franja.ts`, America/Bogota sin horario de verano, UTC-5 fijo). Esto le permite al panel mostrar una venta PARCIAL de la jornada en curso (foto de la tarde − foto de la mañana), no solo el cierre de un día contra el anterior — ver `docs/seguimiento-dos-fotos-dia.md` para el diseño completo. Cada franja tiene su propia ventana de corridas (ver el workflow de GitHub Actions, abajo); dentro de la MISMA franja, llamar de más sigue sin romper nada (ver "Qué NO hacer"), pero ahora SÍ hace falta llamar en la OTRA franja para que llegue la segunda foto del día — eso ya no es opcional como antes.

Mismo criterio que `/api/ml/trabajador` (tarea 2.4, `docs/ESTADO.md`): Railway todavía no tiene el tercer servicio "trabajador de cola" real que pide la decisión D4 del plan técnico — por ahora, un cron externo que llama a este endpoint varias veces al día es honesto con el alcance actual, y se reemplaza por el servicio real cuando el volumen lo justifique.

## Opción ya lista: GitHub Actions

`.github/workflows/revision-diaria-seguimiento.yml` ya está armado, mismo patrón que `trabajador-avisos-ml.yml` — contra staging, con DOS ventanas de 2 corridas cada una:

- **manana**: 14:00 y 15:00 UTC (09:00 y 10:00 en Colombia, UTC-5).
- **tarde**: 22:00 y 23:00 UTC (17:00 y 18:00 en Colombia).

(2 corridas por ventana, no 6 como antes de #244: a la escala real de hoy — Mateo/Débora, bien debajo de 50 seguimientos por empresa — un lote entero cabe en una sola corrida; la segunda es margen. Si el volumen crece, ampliar el rango de horas de CADA ventana es más seguro que agregar una tercera franja.) Para que funcione hace falta:

1. En GitHub → el repo → **Settings → Secrets and variables → Actions**, crear el secreto `SEGUIMIENTO_TRABAJADOR_SECRET_STAGING` con el mismo valor que la variable de entorno `SEGUIMIENTO_TRABAJADOR_SECRET` de Railway en staging.
2. Cuando se conecten cuentas reales en producción (ver el workflow para el comentario completo), duplicar el workflow apuntando al dominio de producción, con su propio secreto `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION`.

Limitación real de GitHub Actions con `schedule`: no garantiza el minuto exacto (puede atrasarse varios minutos en horas de mucha carga de GitHub) — aceptable para una revisión diaria, no lo sería para algo que necesite el minuto exacto. Por eso cada ventana tiene varias horas de margen antes del corte de franja (13:00 Bogotá) de cada lado — un atraso de GitHub Actions de una hora no cambia a qué franja cae la corrida.

**Por qué 22:00-23:00 UTC y no más tarde** (más "exactamente 18:00 Bogotá" sería 23:00 UTC en adelante): cruzar la medianoche UTC partiría la ventana de la tarde en DOS fechas UTC distintas (`seguimiento_fotos.fecha` sigue siendo medianoche UTC, sin cambios por este issue) — dos corridas de la MISMA franja, una antes y otra después de la medianoche UTC, insertarían cada una con un `fecha` diferente para el MISMO seguimiento, y el índice único seguimiento_id+fecha+franja no lo detectaría como duplicado (fechas distintas, aunque la franja sea la misma). 22:00-23:00 UTC es ~17:00-18:00 Bogotá, del lado "tarde" del corte con horas de margen, y nunca cruza la medianoche UTC.

## Alternativa: cron nativo de Railway

Railway permite un servicio tipo "Cron Job" (un comando que corre en un horario, sin quedar levantado entre corridas). Si en algún momento se prefiere no depender de GitHub Actions:

1. Crear un nuevo servicio en el proyecto de Railway (**New → Cron Job**, o el servicio `web` existente con un "Cron Schedule" si Railway lo permite en el plan actual — confirmar en el dashboard, puede variar).
2. Comando: `curl -sf -X POST https://<dominio-del-servicio-web>/api/trabajos/seguimiento -H "x-seguimiento-trabajador-secret: $SEGUIMIENTO_TRABAJADOR_SECRET" --max-time 300`.
3. Horario sugerido: `0 14,15,22,23 * * *` (mismo que el workflow de GitHub — 2 ventanas de 2 corridas, ver arriba). Nunca extender la ventana de la tarde más allá de las 23:00 UTC (ver el por qué, arriba).
4. La variable `SEGUIMIENTO_TRABAJADOR_SECRET` tiene que estar disponible en ESE servicio de cron (puede ser la misma variable compartida del servicio `web`, vía "Shared Variables" de Railway, o una copia — nunca pegada a mano en el comando).

## Alternativa: servicio externo de cron (cron-job.org, EasyCron, etc.)

Si se prefiere no depender de GitHub Actions ni de un servicio nuevo en Railway: cualquier servicio externo que pueda hacer un `POST` HTTPS con una cabecera personalizada en un horario fijo (las 2 ventanas de arriba) sirve igual — apuntando a `https://<dominio>/api/trabajos/seguimiento` con `x-seguimiento-trabajador-secret: <el secreto real>`. El único requisito real es que el servicio soporte HTTPS + cabeceras personalizadas y un timeout de al menos 300s (la mayoría de los gratuitos lo hacen).

## Qué NO hacer

- Nunca pegar el valor real del secreto en este documento, en un commit, ni en un comando de terminal — vive solo en Railway (`SEGUIMIENTO_TRABAJADOR_SECRET`) y, si se usa GitHub Actions, en el secreto de GitHub correspondiente.
- Nunca llamar a este endpoint con un `--max-time` menor a unos minutos: un lote de 50 seguimientos, cada uno con su pausa entre llamadas y sus reintentos en 429, puede tardar varios minutos en terminar — cortarlo a mitad de un lote no rompe nada (cada seguimiento se guarda apenas termina, no al final del lote entero) pero deja el resto del lote sin procesar hasta la próxima corrida.
- Llamar a este endpoint más de lo necesario DENTRO DE LA MISMA franja no rompe nada (un seguimiento ya revisado en esta franja simplemente no vuelve a entrar al lote, ver el filtro en `lib/trabajos/revisionDiariaSeguimiento.ts`), pero tampoco aporta nada una vez que todos los seguimientos activos ya tienen su foto de esta franja. Issue #244 — esto YA NO aplica entre franjas distintas: hace falta una corrida real en la ventana de la tarde para que llegue la segunda foto del día, no alcanza con haber llamado de más a la mañana.
- Nunca programar la ventana de la tarde más allá de las 23:00 UTC (ver el por qué en la sección de GitHub Actions, arriba) — cruzar la medianoche UTC dentro de la misma franja puede crear una foto duplicada con `fecha` distinta para el mismo seguimiento.
