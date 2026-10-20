import type {
  Conector,
  ConectorCuenta,
  ConectorMensaje,
  ConectorPedido,
  ConectorProducto,
} from "./tipos";

// Tarea 2.2 — conector "falso": prueba que el contrato de arriba alcanza
// para implementar un marketplace completo, sin depender de credenciales
// reales de Mercado Libre todavía. Guarda todo en memoria.
export class ConectorFalso implements Conector {
  private conectado = false;
  private productos = new Map<string, ConectorProducto>();
  private pedidos: ConectorPedido[] = [];
  private mensajes: ConectorMensaje[] = [];
  private siguienteId = 1;

  async conectar(_credenciales: unknown): Promise<ConectorCuenta> {
    this.conectado = true;
    return { cuentaIdExterna: "cuenta-falsa-1", nickname: "VENDEDOR_FALSO" };
  }

  async traerPedidos(desde: Date): Promise<ConectorPedido[]> {
    this.requerirConexion();
    return this.pedidos.filter((p) => p.fecha >= desde);
  }

  async traerProductos(): Promise<ConectorProducto[]> {
    this.requerirConexion();
    return [...this.productos.values()];
  }

  async publicarProducto(producto: { titulo: string; precio: number; stock: number }): Promise<{ idExterno: string }> {
    this.requerirConexion();
    const idExterno = `producto-falso-${this.siguienteId++}`;
    this.productos.set(idExterno, { idExterno, ...producto });
    return { idExterno };
  }

  async actualizarStockPrecio(idExterno: string, cambios: { stock?: number; precio?: number }): Promise<void> {
    this.requerirConexion();
    const producto = this.productos.get(idExterno);
    if (!producto) throw new Error(`Producto no encontrado: ${idExterno}`);
    if (cambios.stock !== undefined) producto.stock = cambios.stock;
    if (cambios.precio !== undefined) producto.precio = cambios.precio;
  }

  async traerMensajes(desde: Date): Promise<ConectorMensaje[]> {
    this.requerirConexion();
    return this.mensajes.filter((m) => m.fecha >= desde);
  }

  async responderMensaje(idExterno: string, texto: string): Promise<void> {
    this.requerirConexion();
    const original = this.mensajes.find((m) => m.idExterno === idExterno);
    if (!original) throw new Error(`Mensaje no encontrado: ${idExterno}`);
    this.mensajes.push({
      idExterno: `respuesta-falsa-${this.siguienteId++}`,
      pedidoIdExterno: original.pedidoIdExterno,
      texto,
      fecha: new Date(),
      deComprador: false,
    });
  }

  // Helpers solo para pruebas — simulan eventos del marketplace que en
  // Mercado Libre de verdad llegarían por su API, no por estos métodos.
  _sembrarPedido(pedido: ConectorPedido): void {
    this.pedidos.push(pedido);
  }

  _sembrarMensaje(mensaje: ConectorMensaje): void {
    this.mensajes.push(mensaje);
  }

  private requerirConexion(): void {
    if (!this.conectado) throw new Error("Conector no conectado — llamar conectar() primero.");
  }
}
