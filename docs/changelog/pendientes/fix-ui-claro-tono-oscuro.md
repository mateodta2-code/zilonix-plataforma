- **2026-10-22** — El claro seguía "lavado" después de #115 — Mateo pidió el mismo PESO de marca (azul metálico arriba + plata) que tiene oscuro, no otro matiz más de casi-blanco. Solo `app/globals.css`, solo dentro de `[data-tema="claro"]`.

  **Variables de texto oscurecidas** (punto 2 del pedido — "desbloquea el techo"): estas tres son las que de verdad frenaban cuánto azul/plata podía llevar `--fondo-app`, porque el sidebar y la barra superior las pintan DIRECTO contra ese fondo (sin ningún fondo propio detrás), en toda la altura donde aparezcan:
  - `--icono`: `#686868` → `#333333`
  - `--plata-etiqueta`: `#686868` → `#333333`
  - `--texto-suave`: `#5b6270` → `#333843`

  `--texto` (`#000000`, títulos y cuerpo principal) y `--plata`/`--borde-plata`/`--borde-hover` (bordes, sin requisito AA) no se tocaron — el pedido explícito era solo el texto chico secundario/etiquetas, nunca los títulos ni los bordes.

  **Por qué estos valores y no otros**: se midió con script el alfa máximo de cada color de `--azul-metal-*` antes de romper 4.5:1 contra el texto chico, para varios candidatos de oscurecido. Con el texto viejo (`#686868`), el techo de `--azul-metal-3` (el más claro, el que más margen deja) era ~0.205 — por eso #115 no podía verse más intenso sin romper AA. Con `#333333`, ese mismo techo sube a ~0.892 — más de 4× de margen. Se eligió `#333333` (no algo aún más oscuro) porque ya alcanza para la intensidad pedida sin acercarse a `--texto` (`#000`, hay que seguir distinguiendo texto principal de secundario).

  **El degradado**: pico `--azul-metal-3` al 80% (bien por debajo de su techo real contra el texto más débil de los tres, `--texto-suave` nuevo, que es ~0.835) — resuelve a `rgb(124,164,242)`, un azul metálico claramente visible, no un tinte. `--azul-metal-2` al 48% justo después (su propio techo contra ese mismo texto es ~0.547) para la profundidad/"peso" pedido, sin copiar los rgb casi negros del fondo oscuro — es la MISMA sensación de marca, traducida a un fondo claro, no el mismo degradado con los números cambiados. `--plata-medio`/`--plata` (su techo ahí ya no es un problema, ~0.93/0.88) hacen la transición plateada antes de fundir a blanco limpio. `suave` llega hasta 42% de viewport (antes 36%), `medio` hasta 54%, `intenso` hasta 66% — un poco más de alcance para que la sensación de "peso" no se corte de golpe.

  **Verificado con script, en TODO el tramo (paso de 1%, nunca un punto suelto) de las 3 variantes, contra los 3 textos relevantes** (`--icono`/`--plata-etiqueta` nuevo `#333333`, `--texto-suave` nuevo `#333843`, `--texto` `#000`):

  | Variante | Peor punto | Contraste | Color ahí |
  |---|---|---|---|
  | suave | t=0% (`texto-suave`) | **4.719:1** | `rgb(124,164,242)` |
  | medio | t=0% (`texto-suave`) | **4.719:1** | `rgb(124,164,242)` |
  | intenso | t=0% (`texto-suave`) | **4.719:1** | `rgb(124,164,242)` |

  `--icono`/`--plata-etiqueta` en ese mismo punto mide 5.07:1; `--texto` mide 8.43:1. Ninguna de las 3 variantes, en ningún punto de su tramo completo, bajó de 4.5:1. **Antes/después del oscurecido de texto, con esta misma intensidad de azul**: con `#686868` (el texto viejo) el peor punto real hubiera sido 4.31:1 (reproducido con script antes de decidir oscurecer, no a ciegas) — con `#333333`/`#333843` sube a 4.719:1.

  **Sidebar**: sigue `background: transparent` (sin cambios desde #114) — hereda el degradado reforzado automáticamente.

  **Tema oscuro**: no se tocó ni un carácter — todos los cambios caen dentro del bloque `:root[data-tema="claro"]` (líneas 273-404 aprox.), nunca en `:root` (default) ni en `:root[data-tema="oscuro"]`.

  **No se tocó**: `db/`, `middleware.ts`, `lib/permisos.ts`, `lib/roles*.ts`, `lib/rutas-publicas.ts`, `package.json`, `docs/CHANGELOG.md`. Logo intacto. Solo CSS (y las 3 variables de color de texto del punto 2, dentro de lo que el pedido autorizaba).

  Verificado: `npm run typecheck` en verde. `npm test`: 280 pruebas en verde, 15 archivos fallan solo por variables de entorno (`DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`) ausentes en este entorno — misma base conocida de la rama, nada nuevo roto. `npm run build` compila y tipa en verde; falla después en el mismo tipo de punto ya conocido.
