### Promociones: Bitácora detallada por tanda (Promo-E)

- La bitácora ahora agrupa por tanda (una ejecución: regla en lote, «Dejar de participar en todas», aprobación o acción individual), con encabezado de fecha-hora, usuario, regla y conteos, desplegable a una fila por producto y promoción.
- Quedan registradas también las filas omitidas por la regla y las «no se puede por API» (estado `rechazada`, sin llamar a Mercado Libre), para que 100 = 100.
- Cada fila guarda lote, tope %, límite aplicado, SKU y nombre de la promoción dentro del JSON `resultado_ml` ya existente. Sin migración ni cambios a `db/schema.ts`. Refs #600.
