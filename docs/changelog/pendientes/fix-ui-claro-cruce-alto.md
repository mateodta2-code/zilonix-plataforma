- **2026-10-22** — Mateo confirmó (con captura) que el glow de arriba en claro quedó bien después de #117, pero el cruce a blanco bajaba demasiado — el negro llegaba hasta debajo de las tarjetas KPI. Lo quería cerca de la línea de pestañas (Resumen/Pedidos/Despachos/SKU), no más abajo. Solo `app/globals.css` y `components/marco/BarraLateral.module.css`.

  **El cruce sube**: `suave` pasa de negro 0-60% / blanco desde 78% a **negro 0-30% / blanco desde 32%**. `medio`: 34%/36% (antes 68%/84%). `intenso`: 38%/40% (antes 76%/90%). La capa de azul-metal (0-25%, copiada literal de oscuro) no se tocó — el "glow" de arriba es idéntico a antes, solo se acortó la cola negra sólida.

  **Por qué la banda es tan angosta ahora (2 puntos, antes 12–18)**: con el cruce mucho más arriba, el degradado atraviesa zonas donde SÍ hay texto real (el menú del sidebar) — una banda de transición ancha crea una franja gris intermedia donde, confirmado con script probando las dos opciones en cada punto, NI el texto claro de zona oscura NI el texto oscuro normal de claro llegan a 4.5:1 (ninguno de los dos extremos de contraste alcanza cuando el fondo está a mitad de camino entre negro y blanco). Angostarla a 2 puntos reduce esa franja muerta a una tira de un par de píxeles — dentro del margen que ya absorbe el padding de cada fila del menú, no la zona donde cae el texto/ícono de verdad.

  **Consecuencia real, la misma que anticipaba el pedido**: con el cruce tan arriba, la mayor parte del menú del sidebar ya no cae en la franja oscura. Se modeló la posición real de cada elemento (header 64px + logo ~110px + ~41px por ítem de menú) en dos altos de viewport — 900px ("típico", el que pidió verificar la tarea) y 650px ("corto") — y se verificó con script, probando las dos opciones de texto en cada tramo:

  - **Siguen en zona oscura** (sin cambios): `BarraSuperior` completa, el logo del sidebar, `EncabezadoPagina` (título+descripción, en casi todas las subpáginas — a 900px queda en 11-17% de la altura, a 650px en 15-23%, los dos muy por debajo del 30% nuevo), y en `/panel` el saludo + `Pestanas`.
  - **Vuelven a colores normales de claro** (`BarraLateral.module.css`): "ADMINISTRACIÓN" y los ítems del menú desde **SKU en adelante** (Investigación, Finanzas, Actividad, Personas, y todo el grupo Administración) — a 900px ya caen sobre blanco limpio (21-27%+).
  - **Se quedan en zona oscura, identificados por `href`** (no por posición en la lista, que cambia según el rol — un rol sin "ventas" no ve Pedidos/Despachos y todo se corre): **Inicio, Pedidos y Despachos** (`/panel`, `/panel/pedidos`, `/panel/despachos`) — son los únicos 3 que, a 900px, quedan limpiamente dentro de la franja oscura (16-30%).

  **Contraste, verificado con script** (probando zona-oscura y normal-claro en cada tramo, nunca a mano):

  | Elemento | 900px (típico) | 650px (corto) |
  |---|---|---|
  | Header / logo | 5.1–5.2:1 ✅ | 5.1:1 ✅ |
  | Inicio | 6.3:1 ✅ | 6.3–6.8:1 ✅ |
  | Pedidos | 6.7:1 ✅ | **falla** (cae en la banda de cruce) |
  | Despachos | 6.8:1 ✅ | **falla** (ya sobre blanco, zona oscura no sirve ahí) |
  | SKU (primer ítem "normal") | 5.6:1 ✅ — con un roce marginal de ~2 puntos porcentuales en su borde superior, dentro de la banda angosta | 5.6:1 ✅ |
  | Investigación en adelante | 5.6:1 ✅ | 5.6:1 ✅ |
  | Encabezado/saludo/Pestañas | 5.2–6.8:1 ✅ | 6.1–6.7:1 ✅, **salvo Pestañas**: falla (29-37% a 650px, se mete de lleno en la banda) |

  **Límite real, documentado y no resuelto**: a 900px (el viewport típico que pidió verificar la tarea) todo pasa. A 650px — un viewport realmente chico para un panel de escritorio, pero real — Pedidos, Despachos y Pestañas pueden caer en la banda de cruce o ya sobre blanco con el texto de zona oscura puesto, perdiendo contraste. Resolverlo de verdad (que cada elemento sepa en qué zona cae sin importar el alto exacto del viewport) necesitaría rastrear la posición real con JavaScript — esta tarea pidió una solución CSS, así que se deja anotado en vez de resolverlo a medias con una complejidad que no se pidió.

  **Tema oscuro**: no se tocó — confirmado por rango de líneas del diff, los únicos cambios en `app/globals.css` caen dentro del bloque `[data-tema="claro"]`.

  **No se tocó**: `db/`, `middleware.ts`, `lib/permisos.ts`, `lib/roles*.ts`, `lib/rutas-publicas.ts`, `package.json`, `docs/CHANGELOG.md`. Logo intacto.

  Verificado: `npm run typecheck` en verde. `npm test`: 280 pruebas en verde, 15 archivos fallan solo por variables de entorno ausentes en este entorno — misma base conocida. `npm run build` compila y tipa en verde; falla después en el mismo tipo de punto ya conocido.
