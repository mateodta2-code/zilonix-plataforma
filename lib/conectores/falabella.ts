import type { Conector, ConectorCuenta, ConectorMensaje, ConectorPedido, ConectorProducto } from "./tipos";
import * as cuentasFalabella from "@/lib/falabella/cuentas";
import * as pedidosFalabella from "@/lib/falabella/pedidos";
import { verificarCredenciales } from "@/lib/falabella/cliente";
import { verificarClaveFalabella } from "@/lib/cifrado";

// Primer caso REAL del contrato de la tarea 2.2 (hasta ahora solo probado
// contra ConectorFalso, lib/conectores/falso.ts) — adelanta la tarea 5.1
// del plan técnico (decisión ya confirmada con Mateo/Debora, 15/11).
//
// Alcance de este primer corte, a propósito incompleto (igual que
// Promociones/Programar Full de Mercado Libre todavía no están listas):
// solo `conectar` y `traerPedidos` funcionan de verdad. `traerProductos`/
// `publicarProducto`/`actualizarStockPrecio`/mensajes quedan sin
// implementar — se pidió "conectar la tienda", no clonar todo lo que le
// tomó meses construir a Mercado Libre.
export class ConectorFalabella implements Conector {
  constructor(private readonly empresaId: string, private cuentaId: string | null = null) {}

  async conectar(credenciales: unknown): Promise<ConectorCuenta> {
    const datos = credenciales as { userId: string; apiKey: string; sellerId: string; nickname: string };
    // Issue #422: sin una clave de cifrado válida no se podría guardar la
    // API Key — se corta acá, antes de llamar a Falabella.
    verificarClaveFalabella();
    // Revisión del PR #415 (bloqueante 1): nunca se guarda una cuenta
    // sin que Falabella acepte antes una llamada firmada con esa key.
    await verificarCredenciales(datos);
    const { id } = await cuentasFalabella.guardarCuentaConectada(this.empresaId, datos);
    this.cuentaId = id;
    return { cuentaIdExterna: datos.userId, nickname: datos.nickname };
  }

  async traerPedidos(desde: Date): Promise<ConectorPedido[]> {
    this.requerirConexion();
    await pedidosFalabella.importarPedidos(this.empresaId, this.cuentaId!, desde);
    // Revisión del PR #415: solo los pedidos de ESTA cuenta, no los de
    // todas las cuentas de Falabella de la empresa.
    const filas = await pedidosFalabella.listarPedidos(this.empresaId, this.cuentaId!);
    return filas.map((p) => ({
      idExterno: p.pedidoIdExterno,
      estado: p.estado,
      fecha: p.fecha,
      total: Number(p.total),
      moneda: p.moneda,
    }));
  }

  async traerProductos(): Promise<ConectorProducto[]> {
    throw new Error("Conector Falabella: traerProductos todavía no está implementado (fuera de alcance del primer corte).");
  }

  async publicarProducto(): Promise<{ idExterno: string }> {
    throw new Error("Conector Falabella: publicarProducto todavía no está implementado (fuera de alcance del primer corte).");
  }

  async actualizarStockPrecio(): Promise<void> {
    throw new Error("Conector Falabella: actualizarStockPrecio todavía no está implementado (fuera de alcance del primer corte).");
  }

  async traerMensajes(): Promise<ConectorMensaje[]> {
    throw new Error("Conector Falabella: traerMensajes todavía no está implementado (fuera de alcance del primer corte).");
  }

  async responderMensaje(): Promise<void> {
    throw new Error("Conector Falabella: responderMensaje todavía no está implementado (fuera de alcance del primer corte).");
  }

  private requerirConexion(): void {
    if (!this.cuentaId) throw new Error("Conector Falabella no conectado — llamar conectar() primero.");
  }
}
