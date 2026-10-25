# 2 fotos al día + hora de la última revisión (issue #244)

Decisión de Sharel, 2026-10-25: 2 revisiones reales por día (mañana/tarde, America/Bogota) para poder mostrar una venta PARCIAL de la jornada en curso, no solo el cierre de un día completo — ventaja directa sobre Selltrix, que solo mide cierres diarios.

## Qué cambia en la base (una sola columna, sin migración de datos a mano)

`seguimiento_fotos` pasaba de "una foto por seguimiento por día" a "hasta dos, una por **franja**":

- Columna nueva `franja` (`enum seguimiento_franja`: `"manana"` / `"tarde"`, `lib/seguimiento/franja.ts`) — decide en qué franja cae un instante usando el reloj de Bogotá (UTC-5 fijo, sin horario de verano), con el corte a las 13:00 Bogotá (punto medio entre las corridas reales de ~09:00 y ~18:00).
- El índice único pasa de `(seguimiento_id, fecha)` a `(seguimiento_id, fecha, franja)` — así puede haber dos filas el mismo día (una por franja), pero nunca dos de la MISMA franja.
- `fecha` (medianoche UTC) **no cambia de significado** — sigue siendo la clave de "mismo día" para las ventanas de 7/30 días que ya existían. Solo `franja` distingue cuál pasada es cada fila dentro de ese día.
- Migración `0011`: crea el enum, agrega `franja` con `DEFAULT 'manana'` (backfillea sola las filas históricas, de antes de este issue, sin elegir una por una), recrea el índice único. Nada se borra ni se renombra.

## Cómo se decide "ventas parciales" vs "cierre diario" — sin ninguna tabla ni columna nueva

La pieza clave: **nunca se compara contra "ayer" a secas — se compara contra la foto real más reciente que ya exista**, sea de hoy temprano o de un día previo (antes, `revisarUnSeguimiento` filtraba explícitamente `fecha < hoy`; eso hacía que la pasada de la tarde comparara otra vez contra ayer, duplicando la misma alerta dos veces el mismo día).

Con ese cambio, el resto de la lógica de ventas que YA existía (`ventasDelPeriodo`, `calcularVentasHoy`, `listarSeguimientosConUltimaFoto`) sigue funcionando sin tocarla:

- Si hoy solo tiene una foto (mañana, todavía sin la de la tarde): la "foto anterior" es la de ayer → delta de un día completo, igual que siempre.
- Si hoy ya tiene las dos (mañana y tarde): la "foto anterior" pasa a ser la de la mañana de HOY → el mismo delta de siempre es, sin que nadie lo programe aparte, la venta PARCIAL de la jornada en curso.

Lo único nuevo es la **etiqueta honesta** (`periodoVentas()`, `lib/seguimiento/comparativa.ts`): si las dos fotos comparadas tienen la MISMA `fecha`, el panel marca el número como "Parcial del día"; si son de fechas distintas, se muestra sin esa marca (cierre normal). Pura, sin Postgres — solo compara dos `Date`.

## El filtro de "pendiente" — cómo entra la segunda pasada sin reinventar el cron

`obtenerSeguimientosPendientesDeHoy()` seguía comparando `ultima_revision_ts` contra la medianoche de hoy — con eso, "ya revisado hoy" bloqueaba cualquier otra franja, y la segunda pasada del día SIEMPRE se saltaba. El cambio es un solo límite que ahora depende de la franja actual:

- En franja "manana": límite = medianoche de hoy (idéntico a como era antes — una sola pasada).
- En franja "tarde": límite = el corte de hoy (`limiteFranjaDeHoy`, las 13:00 Bogotá de hoy en UTC) — eso deja pendiente, de nuevo, a quien ya tuvo su pasada de "manana" pero todavía no la de "tarde", sin tocar el resto del filtro (mismo orden ASC NULLS FIRST, mismo `TAMAÑO_LOTE`).

## Cron: 2 ventanas, no 2 corridas sueltas

Un lote nunca alcanza para todos los seguimientos si una empresa tiene más de 50 (`TAMAÑO_LOTE`) — por eso cada franja sigue necesitando una ventana corta de varias corridas, no una sola llamada puntual. `.github/workflows/revision-diaria-seguimiento.yml` pasa de 1 ventana de 6 corridas a 2 ventanas de 2 corridas (14:00-15:00 UTC y 22:00-23:00 UTC — detalle completo, incluido por qué nunca cruza la medianoche UTC, en `docs/cron-seguimiento.md`).

## Qué queda igual (a propósito)

- La primera revisión al agregar (`revisarAhoraUnSeguimiento`, issue #204) sigue disparándose en el mismo request — ahora, además, guarda la franja real de ese instante.
- El aviso "agregado — ya se revisó" vs "primera revisión falló" (`primeraRevisionError`) no cambia.
- El cupo de competidores, las alertas de precio/catálogo/botón de compra, el estimado de Selltrix (`lib/ml/estimacionVentas.ts`) y la medición de #222 (`buscarMedicionSiExiste`) no se tocan.

## Fuera de alcance de #244 (a propósito)

- Extensión de Chrome, parsers de otras plataformas.
- El flujo de Analizar/`PanelDemanda.tsx` (si hiciera falta mostrar "parcial del día" ahí también, es una tarea aparte de quien lo use).
