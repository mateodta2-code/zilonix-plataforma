- **2026-10-24** — issue #166: `/panel/pedidos` se ve más claro. Las ventas de todas las cuentas de Mercado Libre de la empresa salen en una sola lista, con la paginación de 25 de siempre, y la tabla pasó a **filas tipo tarjeta**. Cada fila es un link al detalle, como antes, y muestra el apodo de la cuenta, el número de pedido, la fecha en hora de Bogotá, el total (con `formatearMonto`, como texto) y el estado.

  **Cuenta de ML:** cada fila muestra el apodo de su cuenta (`cuentas_ml.nickname`). `listarPedidosFiltrados` (`lib/ml/pedidos.ts`) lo trae con un inner join a `cuentas_ml` (también con `empresa_id` en la condición) y no pide ninguna otra columna de esa tabla: ni tokens ni ids externos.

  **Filtro por cuenta (`?cuenta=`):** un selector "Cuenta de Mercado Libre" en el mismo formulario de filtros, con "Todas" y una opción por cuenta, desconectadas incluidas. La página valida el id con `leerCuentaMlDeQuery` (`lib/ml/selector-cuenta.ts`): un id que no es de la empresa queda en Todas, sin error. El filtro va en el `WHERE` del conteo y de la página, dentro de `dbComoEmpresa` y con `empresa_id`. La paginación conserva la cuenta elegida.

  **Estado en español y con color** (`lib/ml/estado-visible-pedido.ts`, función pura): combina el estado del pedido con el del envío más reciente (`despachos_ml.status`). Por orden: Cancelada e Inválida (rojo; la cancelación gana sobre el envío), No entregada (rojo), Entregada (verde), Enviada (plata), Pagada (azul) y Pago pendiente / Pago en proceso / Confirmada (plata). Cualquier otro valor sale tal cual, en plata. El estado del envío se lee con una segunda consulta, solo para los pedidos de la página: si un pedido tiene varios despachos se queda el más reciente, y no sale duplicado ni mueve el conteo. Las etiquetas del filtro de Estado pasaron al femenino (Confirmada, Pagada, Cancelada, Inválida); los valores no cambian.

  **Qué tan al día está:** el estado es el de la **última importación** (la inicial, al conectar la cuenta). Todavía no hay sincronización continua (#130), así que las ventas nuevas y los cambios de estado no aparecen hasta entonces. La pantalla no llama a Mercado Libre.

  **Foto del producto:** cada fila ya tiene un **cuadro neutro** (borde y fondo del tema, vacío) donde irá la foto. La foto y el título esperan #129 / #130 (`pedido_items.titulo` e `imagen_url`) y el cambio de CSP (`img-src`) para el servidor de imágenes de Mercado Libre.

  Estilos solo con variables del tema (oscuro y claro), sin colores fijos. En celular la fila pasa a dos líneas, sin scroll horizontal.

  Pruebas: `lib/ml/estado-visible-pedido.test.ts` (pura), con un caso por regla, la cancelación sobre el envío, Pagada con el envío sin salir y un estado desconocido. En `lib/ml/pedidos.test.ts`, contra Postgres, un bloque nuevo con empresas propias: dos cuentas con su apodo, filtro por cuenta con el conteo, el envío más reciente (o null), un pedido con 2 despachos sin duplicar, y aislamiento A/B, incluido el cuentaId de A pasado desde B. La pantalla se revisa en staging.

  Sin migración, sin rutas nuevas, sin llamadas a Mercado Libre. No se tocó `docs/CHANGELOG.md` ni la versión de `package.json`.
