- **feat-publicidad-ganancia-producto** (Refs #256) — En **Publicidad**, pestaña nueva **"Ganancia real por producto"**, junto a Campañas y Anuncios. Es de solo lectura: no escribe en Mercado Libre ni en la tabla de costos de Finanzas.
  - Una fila por publicación sincronizada de la cuenta, anunciada o no. Columnas: Producto (título y SKU en gris), Precio vigente (con ⓘ del precio regular si hay promoción), Costo total, Comisión ML, Envío ("estimado" o "$ 0 · comprador"), Ganancia y Margen.
  - Ganancia = precio vigente − costo total − comisión ML − envío (solo si lo paga el vendedor). Margen = ganancia / precio. Costo total = costo + empaque + envío a agencia, de la tabla de costos de Finanzas. En **Full** el envío a agencia vale $0.
  - Si falta un dato (empaque, envío a agencia, comisión, precio o envío de ML), la fila muestra "—" y no calcula: un dato faltante ya no cuenta como $0. "Sin SKU" (la publicación no tiene SKU) se distingue de "Sin costo" (tiene SKU, pero no está en Finanzas o no tiene costo).
  - Fondo suave por banda según la meta de margen: verde ≥ meta, ámbar ≥ meta/2, rojo por debajo.
  - Arriba: buscador por producto o SKU, filtro por banda con conteos, filtro anunciado sí/no, y tarjetas de productos, ganancia promedio y margen promedio. Encabezado con la fecha en que se consultaron precios y comisiones a Mercado Libre.

  Cambios en el código:
  - `margenRealProducto` (`lib/publicidad/kpis.ts`) devuelve `sin_sku`, aplica la regla de Full y trata empaque y envío a agencia vacíos como sin dato. También afecta la columna Margen de la pestaña Anuncios.
  - `lib/publicidad/costos.ts`: única lectura de costos de Publicidad (`leerCostosPorSku`), con el packing del proveedor como respaldo, igual que el motor de utilidad.
  - `lib/publicidad/ganancia.ts`: filas, bandas, filtros y promedios, con tests.
  - `FilaTabla` acepta `className`.

  Sin migración.
