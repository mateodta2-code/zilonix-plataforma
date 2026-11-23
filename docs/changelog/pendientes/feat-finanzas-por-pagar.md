### Finanzas — Cuentas por pagar (Refs #422)

- Nueva pantalla **Finanzas → Por pagar** (`/panel/finanzas/por-pagar`): todo lo que la empresa debe y aún no ha pagado.
  - Gastos externos pendientes (incluye agencias, transportadoras y Flex o domiciliarios, registrados como gastos de esas categorías).
  - Órdenes de compra de Productos → Compras sin pagar: el valor es lo pedido × costo unitario (las líneas sin costo no suman).
- Tarjetas: total por pagar, vencido, vence en los próximos 7 días y por pagar después (o sin fecha). Se calculan con agregados en SQL.
- Tabla con origen, proveedor, concepto, vencimiento, días de vencido, valor y estado; filtros por origen, proveedor y estado.
- «Marcar pagado» con fecha y medio de pago: actualiza el gasto en `gastos` o la orden en `ordenes_compra` (sin tabla nueva). Ver pide `finanzas.consultar`; marcar pagado, `finanzas.modificar`.
- Migración `0040_ordenes_compra_pago`: `ordenes_compra` gana `fecha_pago` y `medio_pago` (vacías = pendiente). Las órdenes no guardan fecha de vencimiento, así que cuentan como «por pagar después».
