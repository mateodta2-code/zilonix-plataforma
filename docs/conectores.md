# Contrato de conector — tarea 2.2

El núcleo de Zilonix (pedidos, productos, mensajes) nunca habla directo con la API de un marketplace — siempre pasa por esta interfaz (`Conector`, en [`lib/conectores/tipos.ts`](../lib/conectores/tipos.ts)). Mercado Libre es el primer conector real (tarea 2.3 en adelante); un marketplace nuevo el día de mañana solo necesita implementar estas 5 funciones, sin tocar el resto de la app.

## Las 5 funciones

### 1. Conectar

`conectar(credenciales)` — recibe lo que haga falta para autorizar una cuenta (en Mercado Libre, un código de OAuth) y devuelve qué cuenta quedó conectada (`cuentaIdExterna`, `nickname`). Todo lo demás del conector exige haber conectado primero.

### 2. Traer pedidos

`traerPedidos(desde)` — trae los pedidos del marketplace desde una fecha dada. La importación inicial (tarea 2.5) pide 60 días hacia atrás; después, la cola de avisos (tarea 2.4) pide solo lo nuevo.

### 3. Traer/publicar productos

`traerProductos()` trae el catálogo actual del marketplace. `publicarProducto(producto)` crea uno nuevo y devuelve su id externo — necesario para poder enlazarlo con un SKU propio (tarea 2.6).

### 4. Actualizar stock/precio

`actualizarStockPrecio(idExterno, cambios)` — cambia stock, precio, o ambos, de un producto ya publicado. Recibe solo lo que cambió (`{ stock: 3 }` no toca el precio, y viceversa) para que un conector real no tenga que mandar siempre los dos campos si el marketplace permite actualizarlos por separado.

### 5. Mensajes

`traerMensajes(desde)` trae preguntas y mensajes de compradores desde una fecha dada (alimenta la bandeja de atención, tarea 2.9). `responderMensaje(idExterno, texto)` contesta uno puntual.

## El conector falso

[`lib/conectores/falso.ts`](../lib/conectores/falso.ts) implementa el contrato completo guardando todo en memoria, sin ningún marketplace real detrás. Sirve para dos cosas:

- Probar que el contrato alcanza para un marketplace completo (pedidos, productos, mensajes) antes de construir la integración real con Mercado Libre.
- Las pruebas de `lib/conectores/falso.test.ts` ejercitan el **contrato**, no una implementación puntual — si el conector real de Mercado Libre algún día corre estas mismas pruebas, es señal de que el contrato está bien diseñado.

Tiene dos métodos extra (`_sembrarPedido`, `_sembrarMensaje`) que no son parte del contrato — simulan eventos que en un marketplace real llegarían por su propia API, para poder escribir pruebas sin depender de nada externo.
