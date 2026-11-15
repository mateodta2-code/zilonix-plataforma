- **2026-10-24** — issue #156: las tarjetas de cifras (`TarjetaKpi`) pasan de fondo `--superficie` (casi blanco en claro — `#f5f5f6` — sobre la franja oscura de arriba del fondo; casi negro plano en oscuro — `#0b0b0c`) a un degradado vertical gris oscuro propio, en los dos temas. Pedido de Sharel.

  **Colores nuevos** (`app/globals.css`, `:root`, junto a los tokens `--*-zona-oscura` — mismos valores en los dos temas, nunca condicionados por `[data-tema]`): `--kpi-fondo: linear-gradient(180deg, #2b2f36 0%, #1f2228 55%, #16171a 100%)`, `--kpi-exito-texto: #4ade80`, `--kpi-peligro-texto: #f87171`.

  **`components/marco/TarjetaKpi.module.css`, solo `.tarjeta`:** la capa de fondo sólido pasa de `linear-gradient(var(--superficie), var(--superficie))` a `var(--kpi-fondo)`; el radial de la esquina pasa de `var(--acento-resplandor)` a `var(--acento-resplandor-zona-oscura)` (mismo motivo: ya no depende del tema). El borde plateado (`var(--degradado-plata-borde)` en `border-box`), los filetes azules de `::before`/`::after`, el hover y el tamaño/padding quedan exactamente igual. Dentro de `.tarjeta` se redefinen (en cascada, solo para lo de adentro) `--degradado-plata-texto`, `--plata-etiqueta`, `--texto-suave`, `--texto`, `--exito-texto` y `--peligro-texto` a sus equivalentes de "zona oscura" — mismo criterio ya usado por header/sidebar/saludo (`fix-ui-claro-como-oscuro`).

  **Contraste medido con script** (fórmula WCAG de luminancia relativa, no a ojo) contra las 3 paradas del degradado — de la más clara (peor caso) a la más oscura, `#2b2f36` / `#1f2228` / `#16171a`:
  - cifra (parada más clara del degradado de plata, `#e6e6e6`): 10.77 / 12.77 / 14.36 : 1
  - título y detalle (`#c0c0c0`): 7.39 / 8.76 / 9.85 : 1
  - texto zona oscura (`#f2f4f8`): 12.20 / 14.47 / 16.28 : 1
  - variación positiva (`#4ade80`): 7.71 / 9.15 / 10.29 : 1
  - variación negativa (`#f87171`): 4.86 / 5.76 / 6.48 : 1

  Todos pasan AA (4.5:1) incluso en el peor caso.

  **Aplica a todas las `TarjetaKpi` en los dos temas**: inicio (Ventas de hoy, Ventas del mes, Pedidos, Despachos pendientes, SKU sin vincular), Avisos ML e Investigación — incluida la tarjeta sin valor ("Pendiente de conectar"), que usa `--texto-suave` igual que el resto. Nada fuera de `.tarjeta` cambia: fondo de página, sidebar, header, pestañas, `Tarjeta`, `EstadoVacio`, tablas.

  **Sin migración, sin rutas nuevas, sin cambios de lógica** — solo CSS (`app/globals.css` y `TarjetaKpi.module.css`).

  Verificado: `npm run typecheck` en verde.
