- **2026-10-24** — issue #160: la tarjeta **"Ventas del mes"** de `/panel` ya no suma los pedidos con estado `cancelled` ni `invalid`. Usa la misma lista que "Ventas de hoy" (#153 / #154): la constante `ESTADOS_QUE_NO_SON_VENTA` de `lib/panel-kpis.ts`, que ahora está una sola vez, arriba de `calcularVentasDelMes`, y la usan las dos funciones. Antes las dos tarjetas no cuadraban: un pedido cancelado hoy no aparecía en "Ventas de hoy", pero sí sumaba en "Ventas del mes". Siguen contando `paid`, `confirmed`, `payment_required` y `payment_in_process`.

  Lo demás no cambia: el mes de calendario en Bogotá (`rangoMesActual`), `sum(pedidos.total)` en Postgres por moneda como string, el formato, el permiso (`ventas` / `consultar`), `dbComoEmpresa()` y `empresaId` en el `WHERE`. La lista de estados es fija del código, sin SQL armado con texto de afuera.

  **"Pedidos" sigue contando todo el histórico**, cancelados e inválidos incluidos: es un conteo de pedidos, no de ventas. Si se quiere cambiar, va en un issue aparte.

  Pruebas en `lib/panel-kpis.test.ts`, contra Postgres real, con `ahora` fijo: un caso con dos empresas propias (sin mover los números de las pruebas existentes) donde `paid`, `confirmed`, `payment_required` y `payment_in_process` suman y un `cancelled` y un `invalid` con montos enormes no, afirmado como string y con aislamiento A/B; y en el bloque de "Ventas de hoy", "Ventas del mes" del mismo julio tampoco suma el `cancelled` ni el `invalid` de hoy. Las pruebas del borde de mes en Bogotá quedan sin cambios.

  Sin migración, sin rutas nuevas, sin llamadas a Mercado Libre. No se tocó `docs/CHANGELOG.md` ni la versión de `package.json`.
