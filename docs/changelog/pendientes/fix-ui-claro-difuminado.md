- **2026-10-22** — Mateo rechazó el cruce angosto de #118: se veía como un borde duro, no un difuminado. Pidió explícitamente volver a una banda ANCHA (negro → gris → blanco) aunque eso reabriera la zona donde ni un color de texto plano ni otro pasan AA, y resolver el contraste por otro lado — "si hay tensión con AA, prioriza la estética del fade y documenta el peor ratio; no vuelvas a la banda de 2 puntos". Solo `app/globals.css`, `components/marco/BarraLateral.module.css` y `components/marco/Pestanas.module.css`.

  **El difuminado, ancho de verdad**: `suave` negro sólido 0–18%, difuminado a blanco completo en 42% (antes 30%/32%, la banda de 2 puntos que Mateo rechazó). `medio`: 20%→48% (antes 34%/36%). `intenso`: 22%→54% (antes 38%/40%). El glow azul-metal de arriba (0–25%, copiado de oscuro) no se tocó — nada cambia ahí.

  **La zona muerta, confirmada y aceptada a propósito**: con una banda de 24 puntos (suave), hay un tramo real (≈t=22% a t=40%) donde el punto más gris del difuminado (≈rgb(128,128,128)) da **~1.3–1.4:1 contra CUALQUIERA de los dos textos** — ni el de zona oscura ni el normal de claro llegan ni cerca de 4.5:1 ahí. Esto es exactamente lo que Mateo pidió aceptar en el fondo, a cambio de resolver el contraste en otro lado.

  **Dónde se resolvió de verdad: en el texto, no en el fondo.** Token nuevo `--pill-claro: rgba(255,255,255,0.94)` (solo existe en claro — en oscuro cada `var(--pill-claro, transparent)` cae a `transparent`, sin cambiar nada ahí). Se aplicó como fondo PROPIO, siempre, a los elementos que ya no se podía garantizar en qué franja caen:

  - **Ítems del sidebar** (`BarraLateral.module.css`, `.item`): el intento anterior (#118) identificaba a mano cuáles ítems caían en zona oscura y cuáles en blanco, por `href`. Con una zona muerta de 18 puntos en el medio, esa solución ya no alcanza — ahora **todos los ítems** (Inicio, Pedidos, Despachos, SKU, el resto) llevan `--pill-claro` de fondo y color normal de claro (`--icono`) siempre, sin ningún `href` especial. El ítem activo compone el degradado azul de acento SOBRE el pill (dos capas de `background`, separadas por coma), no en su lugar — el pill sigue dando el piso real de contraste, el azul es solo el acento visual de "activo", igual que antes.
  - **`Pestanas`** (solo se usa en `/panel`, confirmado): mismo criterio — `.contenedor` lleva `--pill-claro` de fondo (con un poco de padding y las esquinas de arriba redondeadas, solo en claro — ver abajo) y `.pestana` vuelve a los colores normales de claro.
  - **Se mantuvieron SIN pill, en zona oscura fija**: `BarraSuperior`, el logo del sidebar, `EncabezadoPagina` (título+descripción) y el saludo de `/panel`. Confirmado que su posición real (header 64px + padding + el propio título, ≈96–150px) queda siempre dentro de la franja negra sólida o muy cerca de su borde seguro (hasta ~22% de la altura) en un viewport típico de 900px — y, a diferencia de los ítems del sidebar, son títulos grandes con degradado de texto (`background-clip`): ponerles un fondo tipo tarjeta detrás se vería como un elemento ajeno al diseño, así que se prefirió no pillarlos.

  **Corrección de alcance**: el padding/border-radius nuevos de `.contenedor` (Pestañas) se escribieron bajo `:root[data-tema="claro"] .contenedor` explícitamente — ponerlos en la regla base sin condicionar por tema habría movido la fila de pestañas también en oscuro, que no usa `--pill-claro` y no necesita nada de esto.

  **Contraste, verificado con script** (nunca a mano) — pill sobre los 3 extremos reales del difuminado:

  | Fondo detrás del pill | `--texto` (#000) | `--icono`/`--plata-etiqueta` (#686868) |
  |---|---|---|
  | Negro puro | 18.38:1 | **4.88:1** |
  | Gris medio (el punto más comprometido del difuminado) | 19.67:1 | 5.22:1 |
  | Blanco | 21.00:1 | 5.57:1 |

  El peor caso real es **4.88:1**, con margen sobre el mínimo de 4.5 — y es el MISMO número sin importar en qué punto exacto del difuminado caiga el elemento, porque el pill controla el fondo local en vez de depender de la posición. Para comparar, sin el pill (texto normal de claro directo sobre el fondo) el mismo `#686868` mide apenas **3.77:1 sobre negro puro** y **1.41:1 sobre el gris medio** — confirma que el pill era necesario, no una precaución de más.

  Elementos sin pill (zona oscura fija, confirmados dentro de su rango seguro): `--icono-zona-oscura` (#939393) mide 6.11:1 sobre el pico del azul-metal y 6.84:1 sobre negro puro — de sobra.

  **Tema oscuro**: no se tocó — confirmado por rango de líneas del diff (todos los cambios de `app/globals.css` caen dentro del bloque `[data-tema="claro"]`) y por diseño (`--pill-claro` no existe ahí, cada `var(..., transparent)` cae a su valor de siempre).

  **No se tocó**: `db/`, `middleware.ts`, `lib/permisos.ts`, `lib/roles*.ts`, `lib/rutas-publicas.ts`, `package.json`, `docs/CHANGELOG.md`. Logo intacto.

  Verificado: `npm run typecheck` en verde. `npm test`: 280 pruebas en verde, 15 archivos fallan solo por variables de entorno ausentes en este entorno — misma base conocida. `npm run build` compila y tipa en verde; falla después en el mismo tipo de punto ya conocido.
