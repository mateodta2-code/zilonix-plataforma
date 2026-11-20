import { LimiteMercadoLibreError, salirDePromocionMl, type RespuestaPromocionMl } from "@/lib/ml/cliente";
import { msDeReintento429 } from "@/lib/ml/reintento-429";

// Extraído de app/api/ml/promociones/participando/salir/route.ts para
// que la salida individual y la salida masiva («Dejar de participar en
// todas», lib/ml/promocionesSalirTodas.ts) usen UNA sola copia del
// DELETE con reintento — nunca dos que se desalineen.
//
// Un solo reintento corto para 429 (con el Retry-After real de
// Mercado Libre si vino) y para 423 (Locked — no está en la doc
// pública de esta API, pero se vio real contra Mercado Libre: el ítem
// tiene otra operación de precio/promoción en curso; sin Retry-After,
// espera fija y corta).
const REINTENTOS_DELETE_ML = 1;
const ESPERA_BASE_429_MS = 1500;
const ESPERA_423_MS = 1500;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResultadoSalirConReintento = RespuestaPromocionMl | { bloqueadoPorLimite: true; mensaje: string };

export async function salirDePromocionConReintento(itemId: string, token: string, promotionId: string, promotionType: string): Promise<ResultadoSalirConReintento> {
  for (let intento = 0; ; intento++) {
    try {
      const respuesta = await salirDePromocionMl(itemId, token, promotionId, promotionType);
      if (respuesta.status === 423 && intento < REINTENTOS_DELETE_ML) {
        await esperar(ESPERA_423_MS);
        continue;
      }
      return respuesta;
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_DELETE_ML) {
        await esperar(msDeReintento429(ESPERA_BASE_429_MS, error.retryAfterMs));
        continue;
      }
      if (error instanceof LimiteMercadoLibreError) {
        return { bloqueadoPorLimite: true, mensaje: `Mercado Libre está limitando las peticiones ahora mismo (${error.message}) — probar de nuevo en unos segundos.` };
      }
      throw error;
    }
  }
}
