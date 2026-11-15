- **feat-publicidad-rentabilidad-margen** — En **Publicidad**, pestaña Campañas, hay una sección nueva: **"Rentabilidad Ads"**, como en el tablero de referencia de Melisa.
  - Con un margen del producto de **30 %**, el **ROAS de equilibrio** es **3,33x** y el ACOS máximo es 30 %. Por debajo de ese ROAS, la publicidad se come todo el margen.
  - Por cada campaña muestra el ROAS actual, el ROAS de equilibrio, el **margen después de Ads** (margen − ACOS) y un estado:
    - 🟢 **Rentable**: queda al menos el 20 %.
    - 🟠 **Margen bajo**: queda entre 0 % y 20 %.
    - 🔴 **Pierde plata**: el ACOS supera el margen, o gastó sin vender.

  El margen (30 %) y el mínimo (20 %) son **fijos por ahora**: `MARGEN_PRODUCTO` y `MARGEN_MINIMO_POST_ADS` en `lib/publicidad/config.ts`, también en `ConfigPublicidad` para que una pantalla futura los cambie por empresa. La pantalla aclara que es un margen general, no el de cada producto.

  Cálculo sin float en `lib/publicidad/kpis.ts` (`roasEquilibrio`, `rentabilidadCampana`). Sin migración.
