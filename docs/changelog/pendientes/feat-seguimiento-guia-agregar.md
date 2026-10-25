- **2026-10-24** — issue #200 (Refs), pedido de Sharel: en `/panel/investigacion/seguimiento`, la tarjeta "Agregar producto, tienda o competidor" solo tenía el "?" chico (`components/marco/Ayuda.tsx`, issue #193) — un cliente no se orientaba con eso solo. Se agrega un botón "Cómo encontrar el id / Ver guía" junto al título de la sección que abre un panel lateral con la guía completa (el "?" se queda, para un recordatorio rápido sin abrir nada).

  **Nuevo `components/marco/PanelLateral.tsx` + `.module.css`** — componente de marco reutilizable: un `<dialog>` nativo (Escape y el backdrop para cerrar vienen gratis del navegador, sin ninguna librería ni manejo de foco a mano) posicionado como un panel pegado al borde derecho de la pantalla, nunca centrado como un `<dialog>` normal. Misma superficie que Inicio (`--tarjeta-fondo`, issue #156/#186) con los mismos tokens de zona oscura que ya usa `Tarjeta.module.css` — nunca `--superficie`/blanco.

  **Guía nueva** (`GuiaAgregarSeguimiento`, dentro de `page.tsx`), 5 secciones en español simple:
  1. Elegir tipo — qué significa seguir un Producto vs una Tienda/vendedor.
  2. Producto — qué pegar (link o id MCOxxxxxxxx) y cómo copiar el link de la barra de direcciones.
  3. Tienda/vendedor — preferir el seller_id numérico; qué formas de link también funcionan (`seller_id=`, `CustId=`, `_CustId_`); aviso explícito de que un link de tienda oficial o de nickname SOLOS (sin esos parámetros) no alcanzan.
  4. Cómo conseguir el id de un competidor — abrir una publicación suya, clic en "Vendido por...", copiar el link de ESA página (o usar el botón "Seguir en Zilonix" de la extensión).
  5. "Es competidor" — qué es, el cupo de 5, y cómo cambiarlo después (pegar de nuevo el mismo link/id con la casilla en el estado que quieras — `agregarSeguimiento` ya actualiza la fila existente en vez de duplicarla, verificado contra el código real).

  **No se tocó**: `?agregar=`/`?agregar_tienda=` (la extensión sigue abriendo esta pantalla igual), ninguna migración, ninguna cifra de "visitas".

  Verificado: `npm run typecheck` en verde. `npm test`: 637 pruebas en verde (sin DB), mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` ausentes en este entorno — ninguno nuevo por este cambio.
