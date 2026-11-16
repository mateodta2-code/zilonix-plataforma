- **feat-publicidad-semaforo-3-colores** — En **Publicidad**, la etiqueta de diagnóstico de cada campaña pasa a ser un **semáforo de tres colores**, igual que el tablero de referencia de Melisa. Compara el ROAS real del periodo contra el ROAS objetivo:
  - 🟢 **En objetivo:** desde el 90 % del objetivo. Antes hacía falta el 100 %.
  - 🟠 **Bajo objetivo:** entre el 70 % y el 90 %. Antes era rojo.
  - 🔴 **Muy bajo:** bajo el 70 %. Antes era la alerta "Bajo el 70 % del objetivo", sin etiqueta. Es el mismo 70 % de la recomendación «Apagar y crear una nueva».
  - "Excelente" (desde 1,2 veces el objetivo) y "Aprendiendo" no cambian.

  Cambios en el código:
  - `diagnosticarCampana` tiene un tipo nuevo, `muy_bajo`. La constante nueva es `UMBRAL_EN_OBJETIVO` (`0.90`), en `lib/publicidad/config.ts`.
  - `fraseEstado` usa los mismos tres tramos.
  - `Chip` tiene un estado nuevo, `advertencia` (naranja, con el token `--advertencia`).

  Sin migración.
