## Sin publicar

- **Proyección de inventarios** (`/panel/inventario/proyeccion`, módulo Productos): cuatro vistas con los datos propios de Seller (stock de las bodegas propias y ventas ya importadas, sin Fulfy). «Qué comprar hoy» (semáforo con días de cobertura, fecha de agotamiento y cantidad sugerida), «Plan de compra» (agrupado por cómo se compra; crea una orden de compra real), «Rotación y tendencia» (ventas por día en 3, 7, 14, 20 y 30 días, ABC) y «Reglas y entregas».
- Reglas editables por empresa: días a cubrir, colchón, ventana de ventas y días de entrega por forma de compra (nacional, plataforma, avión), con días propios por SKU.
- Migración `0058`: tablas `proyeccion_configuracion` y `proyeccion_sku` con RLS (`db/rls-setup.sql`) y su prueba de aislamiento (`db/rls-proyeccion.test.ts`).
