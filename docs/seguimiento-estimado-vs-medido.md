# Ventas estimadas vs. medidas (issue #222)

Nota corta de diseño — ventaja real sobre Selltrix: cuando un producto ya está en Seguimiento con suficiente historial real, Investigación puede mostrar un número **medido** (dato real de Mercado Libre) en vez de solo **estimado** (fórmula).

## Las dos fuentes, ya existentes

- **Estimado** — `lib/ml/estimacionVentas.ts`, `ventasMesEst()`. Fórmula tipo Selltrix sobre `sold_quantity` acumulado + `date_created`, en vivo contra la API. Nunca Postgres.
- **Medido** — `lib/seguimiento/ventas.ts`, `ventasDelPeriodo()`. Resta real entre dos fotos de `seguimiento_fotos.vendidos` (snapshot diario de `lib/trabajos/revisionDiariaSeguimiento.ts`). Dato 100% real, nunca una proyección.

## El gap que cerró este issue

Las dos funciones vivían sin conocerse: nada decidía cuál mostrar, y nada sabía si un `itemId` de Investigación ya estaba siendo seguido con suficiente antigüedad real.

Tres primitivas nuevas (sin migración — las columnas ya existían):

1. **`elegirVentasMes(estimado, medido)`** (`lib/seguimiento/ventas.ts`, pura) — medido gana si no es `null` (incluyendo 0); si no, cae al estimado.
2. **Ventana de ~7 días** (5-9, mismo margen relativo que la ventana de 25-35 que ya usa `fotoCerca30d` para "~30 días") dentro de `buscarMedicionSiExiste`.
3. **`buscarMedicionSiExiste(empresaId, mlIdExterno)`** (`lib/seguimiento/seguimientos.ts`) — `mlIdExterno` es el mismo `itemId` que usa Investigación (ver [`docs/investigacion-proceso.md`](investigacion-proceso.md); issue #227 sacó esto de `lib/ml/investigacion.ts`, ahora borrado, a `lib/ml/listadoCliente.ts`, pero el `itemId` de Mercado Libre es el mismo concepto). `null` si el producto no está en seguimiento activo, o si no hay todavía una foto real en la ventana de 7 días (nunca se aproxima con una foto fuera de ventana, nunca se inventa un número).

## Fuera de alcance de #222 (a propósito)

- **Conectar esto al flujo de Analizar/`PanelInvestigacion.tsx`** — es #221, de Code 1 (la pantalla se reescribió después en #227, ver [`docs/investigacion-proceso.md`](investigacion-proceso.md)). Las primitivas están listas; el enganche (cuándo llamarlas, cómo se ve en pantalla) lo decide esa tarea.
- Extensión de Chrome, parsers de otras plataformas.
- El cupo de competidores de Seguimiento (`LIMITE_COMPETIDORES_POR_EMPRESA`) sigue igual, sin cambios — "medido" solo existe para lo que la empresa ya decidió seguir explícitamente (opt-in), nunca para cualquier búsqueda suelta de Investigación.
