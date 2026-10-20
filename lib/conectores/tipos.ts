// Tarea 2.2 — contrato único que el núcleo usa para hablar con cualquier
// marketplace. Mercado Libre (tarea 2.3+) es el primer conector real; un
// marketplace nuevo el día de mañana solo necesita implementar esto, sin
// tocar el resto de la app.

export type ConectorPedido = {
  idExterno: string;
  estado: string;
  fecha: Date;
  total: number;
  moneda: string;
};

export type ConectorProducto = {
  idExterno: string;
  titulo: string;
  precio: number;
  stock: number;
};

export type ConectorMensaje = {
  idExterno: string;
  pedidoIdExterno: string | null;
  texto: string;
  fecha: Date;
  deComprador: boolean;
};

export type ConectorCuenta = {
  cuentaIdExterna: string;
  nickname: string;
};

export interface Conector {
  // 1. Conectar — intercambia credenciales (ej. código OAuth) por una
  // cuenta ya autorizada en el marketplace.
  conectar(credenciales: unknown): Promise<ConectorCuenta>;

  // 2. Traer pedidos
  traerPedidos(desde: Date): Promise<ConectorPedido[]>;

  // 3. Traer/publicar productos
  traerProductos(): Promise<ConectorProducto[]>;
  publicarProducto(producto: { titulo: string; precio: number; stock: number }): Promise<{ idExterno: string }>;

  // 4. Actualizar stock/precio
  actualizarStockPrecio(idExterno: string, cambios: { stock?: number; precio?: number }): Promise<void>;

  // 5. Mensajes
  traerMensajes(desde: Date): Promise<ConectorMensaje[]>;
  responderMensaje(idExterno: string, texto: string): Promise<void>;
}
