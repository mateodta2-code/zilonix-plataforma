import { cargarDevolucionesEmpresa, rotuloEnvioDevolucion } from "@/lib/ml/devoluciones";
import { guardarDevolucionesMl } from "@/lib/inventario/devoluciones";
import { devolucionPorLlegar, diaBogotaDe } from "@/lib/inventario/devoluciones-reglas";

// Productos → Devoluciones (28-nov): «infórmanos que está por llegar».
// Trae de Mercado Libre las devoluciones con envío de vuelta en camino o
// entregado, con la MISMA lectura de Posventa → Devoluciones (solo GET
// documentados de post-purchase, con sus topes), y las guarda «por
// llegar». Ventana: 60 días.
const DIAS_VENTANA = 60;

export type ResultadoTraerDevoluciones = {
  nuevas: number;
  actualizadas: number;
  sinVenta: number;
  cuentasSinRevisar: string[];
  truncado: boolean;
};

export async function traerDevolucionesMl(empresaId: string, usuarioId: string, ahora = new Date()): Promise<ResultadoTraerDevoluciones> {
  const carga = await cargarDevolucionesEmpresa(empresaId, { cuentaId: null, desdeMs: ahora.getTime() - DIAS_VENTANA * 24 * 60 * 60 * 1000 });
  const porLlegar = carga.filas
    .filter((f) => devolucionPorLlegar(f.estado))
    .map((f) => ({
      reclamoId: f.reclamo.id,
      // El recurso del reclamo es la orden de ML.
      ordenId: f.reclamo.recurso === "order" ? f.reclamo.recursoId : null,
      fecha: diaBogotaDe(f.reclamo.fecha, ahora),
      estadoEnvio: rotuloEnvioDevolucion(f.devolucion?.envios[0]?.estado ?? null),
      cuentaMlId: f.cuentaMlId,
    }));
  const guardado = await guardarDevolucionesMl(empresaId, usuarioId, porLlegar);
  return {
    ...guardado,
    cuentasSinRevisar: carga.cuentasSinRevisar.map((c) => c.nickname),
    truncado: carga.truncado || carga.sinLeerDetalle > 0,
  };
}
