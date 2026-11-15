- **2026-11-15 (Refs #42)** — Release de `main` completo a `produccion`. Versión `0.1.1` → `0.4.0` (`package.json` y `package-lock.json`). Entran Publicar, Promociones, Despachos, Inicio, Roles y Personas, multipaís, extensión, Finanzas, Pedidos, Inventario, Foro e impresión masiva de guías. Clip sale, igual que en `main` (#383). No cambian las versiones de `next`, `react`, `@clerk/*` ni `drizzle`. Las migraciones 0014 a 0023 y `db/rls-setup.sql` quedan para aplicarse a mano en producción, fuera de este PR.

Refs #42
