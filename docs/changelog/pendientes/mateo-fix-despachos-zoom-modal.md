- **2026-10-31** — **Bug real reportado por Mateo en staging (`bd54463`), de nuevo tras el intento anterior**: la foto ampliada de `/panel/despachos` seguía saliendo mal — el popover flotante por posición absoluta (primero por `:hover`/`:focus-within` puro, después por estado de React) se superponía encima de la tarjeta y tapaba el título/precio/datos. Cambio de enfoque pedido explícito por Mateo: nada de zoom flotante sobre la tarjeta — ahora es un **modal (lightbox)** centrado en la pantalla:
  1. Click o tap en la miniatura abre el modal; sin hover — pasar el mouse no abre nada.
  2. Fondo oscuro semitransparente encima de TODA la página (`position: fixed`, `inset: 0`, `z-index` alto), con **portal a `document.body`** (`components/marco/FotoConZoom.tsx`, `createPortal`) — así ningún `overflow`/`isolation` de una tarjeta ancestra (`Tarjeta.module.css`) lo recorta ni lo tapa, el bug real de los dos intentos anteriores.
  3. La foto se ve completa dentro del modal (`object-fit: contain`, máximo 90vw × 85vh), enmarcada con `<Tarjeta>` (mismo borde/degradado plata-azul de marca de `/panel`, mismo fondo de zona oscura en los dos temas — reusado tal cual, sin CSS nuevo para el borde).
  4. Se cierra con el botón X, con Esc, o con click en el fondo (nunca con un click que empieza o termina adentro del marco). Bloquea el scroll del fondo mientras está abierto (`document.body.style.overflow`), restaurado al valor de antes al cerrar.
  5. Accesible: `role="dialog"`, `aria-modal="true"`, `aria-label` con el título del producto, y foco movido al botón Cerrar al abrir.
- **Un solo componente reutilizable** (`FotoConZoom`, `components/marco/`) — reemplaza el markup/CSS que antes vivía duplicado en `TarjetaDespachoCliente.tsx`/`page.module.css` (clases `.contenedorImagen`/`.lupa`/`.lupaAbierta`, eliminadas). Pendientes y Despachados ya comparten ese mismo componente (`TarjetaDespachoCliente`), así que una sola corrección cubre las dos pestañas, en los dos temas y en celular — sin componente nuevo por pantalla.
- Sin migración, sin tocar `lib/ml/cliente.ts` ni `db/schema.ts`.

## Pruebas
- `components/marco/FotoConZoom.test.tsx` (corre con DOM real/jsdom, sin Postgres — mismo patrón que `PaginaPromociones.test.tsx`):
  - Pasar el mouse por la miniatura no abre nada (sin hover).
  - Click en la miniatura abre el modal, mueve el foco al botón Cerrar y bloquea el scroll del fondo.
  - El botón X cierra el modal y restaura el scroll.
  - Esc cierra el modal.
  - Click en el fondo cierra el modal; un click adentro del marco de la foto no lo cierra.
