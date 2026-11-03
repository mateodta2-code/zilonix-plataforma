- **2026-11-03** — **"ver detalle" en el historial de Publicar ya no navega a otra página**: antes abría `/panel/publicar/[id]`, que mostraba el estado crudo de Mercado Libre en inglés ("publicado (paused)"). Ahora despliega EN LA MISMA FILA (toggle "ver detalle"/"ocultar") una línea por cuenta, igual que la tabla equivalente de Zilonix OS (`components/negocio/MercadoLibrePublicar.js`): nombre de la cuenta, estado en español, "Ver publicación" (permalink real, pestaña nueva) y, para una cuenta ya publicada, el botón "Ver estado real" (consulta el `status` actual de ESE ítem contra Mercado Libre, sin recargar la página). `/panel/publicar/[id]` sigue existiendo sin cambios para quien tenga ese link viejo guardado.
  - Traducción de estados centralizada en `lib/ml/estado-publicacion.ts` (`active`→Activa, `paused`→Pausada, `closed`→Finalizada, `under_review`→En revisión, `inactive`→Inactiva, genérico para el resto) — nunca más un código en inglés visible. Distingue "Publicado (sin verificar)" (el `status` que quedó guardado al publicar, nunca vuelto a confirmar) de "Publicado y activo" (después de "Ver estado real").
  - Nueva ruta de solo lectura `GET /api/ml/publicar/estado-item` (mismo grupo/permiso que el resto de `app/api/ml/publicar/*`: "inventario","consultar") — usa `obtenerFotoItemMl` ya existente en `lib/ml/cliente.ts`, sin tocar ese archivo.
  - Una cuenta fallida muestra su motivo en español; el reintento sigue siendo el botón "Cargar / Reintentar" ya existente (precarga el formulario solo con las cuentas que fallaron) — no existe todavía un reintento puntual por cuenta, así que no se agregó un botón nuevo para eso.
  - El precio sigue formateado con `lib/ml/sitios.ts` (sin cambios); nunca "$"/COP fijo.

## Pruebas
- `lib/ml/estado-publicacion.test.ts`: los 5 estados documentados, un estado no mapeado (nunca el código crudo a secas) y la distinción sin-verificar/activo.
- `app/panel/publicar/formulario-logica.test.ts` (`detalleCuentasProducto`): éxito clásico, fallo (sí aparece, a diferencia de `enlacesPermalink`), familia con ítems mezclados, cuenta sin match.
- `app/panel/publicar/HistorialPublicaciones.test.tsx`: "ver detalle"/"ocultar" nunca es un `<a>` de navegación, cuentas con estados mezclados, y "Ver estado real" actualiza el texto sin recargar (fetch mockeado).

Sin migración.

Refs #367
