## 2026-11-20 — Publicar: atributos con unidad (number_unit) y filas «Publicando…» colgadas

- **Arreglo:** Publicar mandaba «18» sin unidad en atributos `number_unit` (ej. edad máxima) y Mercado Libre respondía 400 (`number_invalid_format`). Ahora se agrega la unidad por defecto de la categoría, se valida la unidad escrita contra las permitidas (error claro en español antes de llamar a Mercado Libre) y el formulario muestra número + selector de unidad.
- **Arreglo:** las filas que quedaban en «Publicando…» por más de 10 minutos se cierran como con errores («La publicación no terminó…») y el historial ya no muestra «(sin título)» mientras publica.
- Sin migraciones.
