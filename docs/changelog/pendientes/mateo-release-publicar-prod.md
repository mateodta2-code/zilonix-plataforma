- **2026-10-29 (Refs #44)** — Release selectivo a `produccion`: solo Publicar + Clip + extensión 0.3.41. Cherry-picks desde `main` sobre el tip de `produccion` (c7d9f50 / PR #274). **Sin migraciones**, sin cambios a `db/`, `db/schema.ts` ni `db/rls-setup.sql`.

  **Incluido (squash commits de main, en orden):**
  - #276 Publicar Parte 1 — UX de categoría, atributos, variantes y galería (`cab723e`)
  - #281 página única Publicar con estructura Zilonix OS (`9ca6124`)
  - #286 importadores + fotos Cloudinary + extensión 0.3.39 (`8f51239`)
  - #288 permalink real en historial + rediseño fotos (`c192c43`)
  - #290 extensión 0.3.40 — interruptor del panel + `URL_APP` según Seller (`565cc0a`)
  - #291 extensión 0.3.41 — Importar a Publicar abre/enfoca + video a Clip (`b840712`)
  - #292 Clip multi-cuenta con streaming, moderación real y anti-SSRF (`ff8819e`)

  **Excluido a propósito (sigue en `main`, no entra a prod en este PR):**
  - Finanzas / Pedidos (#272, #275, #277, #278, #279, #282, #283, #285, #287)
  - Sharel panel más ancho (#289)
  - WMS Fase 1 (#284 / `95128fc`)
  - Migraciones 0014 / 0015 / 0016 y cualquier cambio de schema/RLS de esos módulos

  **Variables de entorno a setear en producción (Railway) antes o al mergear — solo NOMBRES, nunca valores:**
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — fotos PC/Canva → Cloudinary en Publicar
  - `CLIP_HABILITADO=true` — prende el sub-flujo de Clip

  **Réplicas:** mantener **1 sola réplica** en prod mientras Clip esté prendido. Los jobs de Clip y los videos temporales viven en un Map en memoria; con más de 1 réplica el polling / `tempVideoId` pueden caer en la réplica equivocada y dar 404.

  **No hace falta:** correr migraciones, tocar `rls-setup.sql`, ni deployar a mano desde este PR (el flujo de prod ya existente).

Refs #44
