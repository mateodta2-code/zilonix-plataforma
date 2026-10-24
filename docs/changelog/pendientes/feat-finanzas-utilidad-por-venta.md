- **2026-10-23** — Z-FIN-09 (issue #131), **solo el motor**: `lib/finanzas/utilidad-venta.ts` calcula la utilidad de cada venta antes de publicidad, como función pura (no lee la base ni mira el reloj). Fórmula del OS: valor de venta − comisión ML − flete ML − costo del producto − empaque − envío (si aplica); margen % = utilidad ÷ valor de venta. La publicidad no entra.

  **Dinero sin float.** Los montos entran y salen como texto `"12345.67"` (igual que `numeric(14,2)`) y por dentro se suman en centavos con `BigInt`. Nunca `Number`. Una prueba suma 1.000 ventas en el tope de `numeric(14,2)` y no pierde ni un centavo.

  **Varias líneas.** Valor de venta, comisión y flete se reparten por el peso de cada línea con el método del residuo mayor: la suma de las partes da exactamente el total, aunque los centavos no dividan parejo. Empaque y envío se cobran una sola vez por paquete.

  **Forma de entrega.** Sale del dato de la venta (`full_ml`, `flex`, `agencia`, `desconocida`), nunca del prefijo del SKU. Full de ML = envío $0. Flex y Agencia usan el envío congelado (un SKU FUL de Infinity vendido por Agencia paga sus $2.000).

  **Costo.** Vacío (nulo) = "sin costo": la venta queda fuera de la utilidad, pero cuenta para el % de ventas con costo. Costo 0 puesto a propósito = costo real de $0, cuenta como "con costo" y sin alerta. Costo provisional: la venta lleva la marca "usa costo provisional", su utilidad se suma igual y los totales muestran aparte cuántas ventas lo usan y cuánta utilidad depende de ellas.

  La marca "usa costo provisional" solo aparece si la venta tiene costo completo: una venta con una línea provisional y otra sin costo queda sin costo y sin marca (ni la venta ni sus líneas).

  **Montos negativos.** El costo, el empaque y el envío no pueden ser negativos, ni congelados ni corregidos a mano (un negativo inventaría utilidad): el motor los rechaza con `EntradaUtilidadInvalidaError`. Esto vale también para el envío congelado de una venta Full, aunque no se use. Comisión y flete sí pueden ser negativos (bonificaciones o reintegros de ML).

  **Correcciones manuales.** Solo los campos de la lista cerrada (`costo_producto`, `empaque`, `envio_agencia`, `comision_ml`, `flete_ml`), validados también en tiempo de ejecución. La corrección activa gana sobre el congelado; anulada, vuelve el congelado. Cada concepto dice si es "congelado", "corregido" o "full_ml".

  **Fecha.** El día y el mes son los de Bogotá (UTC-5 fijo) de `fecha_pago_aprobado`, con prueba de 23:59 / 00:00 y de cambio de mes.

  **Totales.** `totalizarUtilidad` y `totalizarPorCuentaYMes` suman por cuenta y mes de Bogotá, con % de ventas con costo, ventas con costo provisional y utilidad que depende de provisional. También cuentan cuántas ventas tienen empaque sin dato (`ventas_empaque_sin_dato`), envío sin dato (`ventas_envio_sin_dato`) y forma de entrega desconocida (`ventas_forma_desconocida`); esos contadores incluyen las ventas sin costo, porque muestran qué hay que revisar en la foto congelada. En Full, un envío vacío no cuenta como "sin dato" porque no se usa. La suma de las utilidades por venta da exactamente los totales (prueba).

  Pruebas en `lib/finanzas/utilidad-venta.test.ts` (vitest, sin Postgres, datos inventados): venta completa, sin costo, costo 0, dos y tres líneas con reparto exacto, Full, Flex, Agencia con SKU FUL, costo provisional con y sin marca (incluida una línea provisional junto a otra sin costo), contadores de empaque/envío sin dato y forma desconocida, montos negativos rechazados (y comisión/flete negativos aceptados), corrección activa y anulada, devolución parcial, día de Bogotá, totales por cuenta y mes, montos grandes.

  **Supuestos tomados (a confirmar con Mateo o Sharel):**
  - [SUPUESTO] El costo de cada línea (`costo_congelado`) es el costo total de la línea, ya multiplicado por la cantidad, no el unitario.
  - [SUPUESTO] Si una sola línea de la orden no tiene costo, la orden entera queda fuera de la utilidad (no se suma solo la parte con costo).
  - [SUPUESTO] Una corrección de toda la orden (línea nula) fija el total y se reparte por peso entre las líneas; si además hay correcciones de línea del mismo campo, gana la de toda la orden y la venta lleva el aviso `correccion_linea_ignorada`.
  - [SUPUESTO] Una corrección de empaque o de envío sobre una línea es un dato inválido (son por paquete) y el motor la rechaza.
  - [SUPUESTO] Un costo corregido a mano deja de ser provisional.
  - [SUPUESTO] Devolución parcial: `valor_venta` ya llega neto de reembolsos; el costo congelado se mantiene completo. Si la unidad volvió a inventario, se ajusta con una corrección de `costo_producto`.
  - [SUPUESTO] Empaque o envío congelado vacío cuenta como $0 y la venta lleva un aviso; solo el costo vacío saca la venta del cálculo.
  - [SUPUESTO] Forma de entrega `desconocida` usa el envío congelado, como Agencia, y avisa.
  - [SUPUESTO] Una corrección de envío gana también sobre la regla de Full ($0).
  - [SUPUESTO] "Utilidad que depende de costos provisionales" = suma de la utilidad de las ventas con costo provisional (que siempre tienen costo completo).
  - [SUPUESTO] Si todas las líneas valen $0, el reparto se hace en partes iguales.
  - El motor no recibe ventas canceladas: filtrarlas es tarea de quien lo llama.

  **No entra en este cambio:** pantallas, base de datos (`db/` sin cambios) ni el recálculo masivo. Refs #131.
