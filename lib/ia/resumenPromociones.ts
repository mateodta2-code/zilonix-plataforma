import { obtenerConexionIAConClave } from "@/lib/ia/conexion";
import { llamarIA } from "@/lib/ia/proveedores";
import type { CandidatoCalculado } from "@/lib/ml/promociones";

// Rama feat-promociones, punto 6 — "En Promociones la IA solo explica
// y resume; los números siempre salen del motor de reglas. Sin IA
// conectada, el módulo funciona igual". Mismo criterio que
// zilonix-os-web: el prompt deja clarísimo que no hay que recalcular
// nada (bug real evitado ahí — una IA proponiendo números distintos a
// los ya calculados). Si la empresa no conectó ninguna IA, o la
// llamada falla por lo que sea, se devuelve null — nunca rompe el
// flujo de Promociones, que sigue funcionando solo con los números.
export async function resumenPromocionesIA(empresaId: string, candidatos: CandidatoCalculado[]): Promise<string | null> {
  if (candidatos.length === 0) return null;
  const conexion = await obtenerConexionIAConClave(empresaId);
  if (!conexion) return null;

  const lista = candidatos.map((c) => ({
    producto: c.tituloProducto ?? c.itemId,
    accion: c.accionSugerida,
    cumple: c.cumpleReglas,
    precio_actual: c.precioActual,
    precio_minimo: c.precioMinimo,
    precio_sugerido: c.precioSugerido,
    ganancia_estimada: c.gananciaEstimada,
    motivo: c.motivoRevisarManual,
  }));

  const prompt = `Eres el asistente de Zilonix Seller. El sistema YA calculó qué promociones de Mercado Libre conviene aceptar — tu único trabajo es EXPLICARLO en español claro para una persona no técnica, nunca recalcular ni cambiar ningún número.

Candidatos ya calculados (JSON):
"""
${JSON.stringify(lista)}
"""

Escribe un resumen corto: cuántos productos cumplen las reglas y están listos para aplicar, cuántos quedaron para revisar a mano (con el motivo agrupado, sin repetirlo producto por producto si se repite), y la ganancia total estimada sumando "ganancia_estimada" de los que cumplen. Nunca inventes productos, precios ni motivos que no estén en el JSON de arriba.`;

  try {
    const texto = await llamarIA(conexion, prompt, { maxTokens: 1500 });
    return texto.trim() || null;
  } catch {
    return null;
  }
}
