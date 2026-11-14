- **melisa-publicidad-recomendaciones** — En **Publicidad** (`/panel/publicidad`), recomendaciones de solo lectura y el anuncio que más gasta (Refs #255). No hay botones ni llamadas a Mercado Libre, y no hay migración.

  **El anuncio que más gasta.** Cada campaña muestra, en la fila y al abrirla, el anuncio de mayor inversión del periodo: título (o MCO), inversión, qué parte del gasto representa y sus ventas. Si dos empatan, salen los dos. Dentro de la campaña, los anuncios van ordenados por inversión y el mayor queda marcado.

  **Recomendaciones de campaña.** Aparecen arriba de la tabla y dentro de cada campaña:
  - En aprendizaje: solo «En aprendizaje, no tocar todavía».
  - ROAS bajo el 70 % del objetivo: «Apagar y crear una nueva».
  - ROAS de al menos 1,3 veces el objetivo: «Subir el objetivo de ROAS / bajar ACOS objetivo». Nunca se sugiere subir presupuesto, bajar el objetivo ni compartir presupuesto.

  **Reglas de ENFRIAMIENTO, VENDEDOR y ANTÁRTIDA** (confirmadas por el usuario el 14-nov). Solo hay tres tipos de campaña:
  - Solo hay una **ENFRIAMIENTO** y una **ANTÁRTIDA**, con ese nombre exacto (sin importar mayúsculas ni tildes). Si hay dos con el mismo nombre: «Debe haber una sola campaña …».
  - **VENDEDOR** puede haber varias: cuenta toda campaña cuyo nombre empiece por VENDEDOR. Una campaña con cualquier otro nombre recibe «Cambiar el nombre de la campaña a VENDEDOR» y sigue las reglas de VENDEDOR.

  Camino del producto: entra a ENFRIAMIENTO; si vende, la campaña pasa a VENDEDOR; si deja de vender, vuelve a ENFRIAMIENTO; el que no vende en ENFRIAMIENTO va a ANTÁRTIDA.
  - **VENDEDOR:** vuelve a ENFRIAMIENTO el anuncio que lleva **7 días sin vender** (gastó en los últimos 7 días completos, hasta ayer, sin ninguna venta) o cuyo **ACOS pasa el 20 %** (el máximo del semáforo, en el periodo elegido). Si la cuenta no tiene ENFRIAMIENTO, se sugiere crearla. El que vende bien (ROAS de al menos 1,5 veces el objetivo) recibe «Vende bien, dejar en esta campaña».
  - **ENFRIAMIENTO con algún anuncio que vende:** «Cambiar el nombre de la campaña a VENDEDOR», y «Quitar de la campaña» solo para los que no venden y pasan el tope de consumo. Los que consumen poquito se dejan.
  - **ENFRIAMIENTO sin ninguna venta:** los que gastan sin vender pasan a ANTÁRTIDA, o se sugiere crearla (presupuesto mínimo, ACOS alto).
  - **ANTÁRTIDA:** el que vende recibe «Vende, dejar en ANTÁRTIDA». El que no vende y pasa el tope recibe «Pausar o sacar de la campaña 7 días; después, volver a ANTÁRTIDA». El que consume poquito se deja.

  El **tope de consumo** es el del semáforo del anuncio: gasto sin ventas sobre el 5 % del precio (`TOPE_GASTO_SIN_VENTAS`). Sin precio no se sabe, así que no se sugiere quitar ni pausar. El aviso «Gasta sin vender» se sigue mostrando donde no hay recomendación (aprendizaje, o un anuncio que consume poquito).

  Constantes nuevas en `lib/publicidad/config.ts`:
  - `UMBRAL_ROAS_BAJO`, `FACTOR_ROAS_HOLGADO`, `FACTOR_ROAS_VENDE_BIEN`
  - `CAMPANA_ENFRIAMIENTO`, `CAMPANA_ANTARTIDA`, `CAMPANA_VENDEDOR`
  - `DIAS_PAUSA_ANTARTIDA`, `DIAS_SIN_VENDER_VENDEDOR`

  `consultarTableroPublicidad` también suma por anuncio los últimos 7 días (`ultimosDias`), contados desde hoy y no desde el mes elegido.
