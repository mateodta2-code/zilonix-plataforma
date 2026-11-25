// Preguntas y reclamos (Refs #51) — versión sin tablas propias: lee en
// vivo de Mercado Libre, cuenta por cuenta, al abrir la pantalla. El
// historial queda en Mercado Libre. Responder es POST /answers con el
// token de la cuenta dueña de la pregunta.

import { and, eq, inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicaciones } from "@/db/schema";
import {
  buscarPreguntasSinResponderMl,
  buscarReclamosAbiertosMl,
  LimiteMercadoLibreError,
  MlNoAutorizadoError,
  MlNoDisponibleError,
  MlSinPermisoAppError,
  type PreguntaMl,
  type ReclamoMl,
} from "@/lib/ml/cliente";
import { obtenerMotivoReclamoMl, plazoDeJugadores } from "@/lib/ml/reclamos";
import { compararPlazo } from "@/lib/preguntas/tiempo";
import {
  CuentaDesconectadaError,
  listarCuentasConectadas,
  obtenerAccessTokenVigente,
  RenovacionTokenFallidaError,
} from "@/lib/ml/cuentas";

export type PreguntaPendiente = PreguntaMl & {
  cuentaMlId: string;
  nickname: string;
  siteId: string | null;
  // De la publicación importada en Zilonix; null si no está importada.
  titulo: string | null;
  precio: string | null;
  stock: number | null;
};

export type ReclamoAbierto = ReclamoMl & {
  cuentaMlId: string;
  nickname: string;
  siteId: string | null;
  // Motivo legible (reasons/{id}); null si ML no lo dio — se muestra el código.
  motivoTexto: string | null;
  // Menor due_date de las acciones del vendedor, ya leído del listado.
  plazo: string | null;
};

export type CuentaSinRevisar = { nickname: string; motivo: string };

export type BandejaPreguntas = {
  preguntas: PreguntaPendiente[];
  // Más preguntas de las que trae una página (50 por cuenta).
  hayMas: boolean;
  reclamos: ReclamoAbierto[];
  cuentasSinRevisar: CuentaSinRevisar[];
};

// Motivo para la persona, nunca el error crudo.
export function motivoCuentaSinRevisar(error: unknown): string {
  if (error instanceof CuentaDesconectadaError || error instanceof RenovacionTokenFallidaError || error instanceof MlNoAutorizadoError) {
    return "Token vencido — hay que reconectar la cuenta.";
  }
  if (error instanceof MlSinPermisoAppError) return "Mercado Libre no dio permiso para leer estos datos de la cuenta.";
  if (error instanceof LimiteMercadoLibreError) return "Mercado Libre pidió esperar un momento. Se reintenta al actualizar.";
  if (error instanceof MlNoDisponibleError) return "Mercado Libre no respondió a tiempo. Se reintenta al actualizar.";
  return "No se pudo consultar ahora. Se reintenta al actualizar.";
}

function porFecha(a: { fecha: string | null }, b: { fecha: string | null }): number {
  const fa = a.fecha ? Date.parse(a.fecha) : Number.POSITIVE_INFINITY;
  const fb = b.fecha ? Date.parse(b.fecha) : Number.POSITIVE_INFINITY;
  return fa - fb;
}

export async function leerBandejaPreguntas(empresaId: string): Promise<BandejaPreguntas> {
  const cuentas = (await listarCuentasConectadas(empresaId)).filter((c) => !c.desconectadaTs);
  const preguntas: PreguntaPendiente[] = [];
  const reclamos: ReclamoAbierto[] = [];
  const cuentasSinRevisar: CuentaSinRevisar[] = [];
  let hayMas = false;

  // En serie: con muchas cuentas, en paralelo se pisaba el límite de
  // llamadas de Mercado Libre.
  for (const cuenta of cuentas) {
    try {
      const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
      const pagina = await buscarPreguntasSinResponderMl(cuenta.cuentaIdExterna, token);
      if (pagina.total > pagina.preguntas.length) hayMas = true;
      for (const pregunta of pagina.preguntas) {
        preguntas.push({ ...pregunta, cuentaMlId: cuenta.id, nickname: cuenta.nickname, siteId: cuenta.siteId, titulo: null, precio: null, stock: null });
      }
      const abiertos = await buscarReclamosAbiertosMl(token);
      // Un motivo por código distinto, no por reclamo.
      const motivos = new Map<string, string | null>();
      for (const reclamo of abiertos.reclamos) {
        if (reclamo.motivo && !motivos.has(reclamo.motivo)) {
          const m = await obtenerMotivoReclamoMl(reclamo.motivo, token);
          motivos.set(reclamo.motivo, m?.detalle ?? m?.nombre ?? null);
        }
        reclamos.push({
          ...reclamo,
          cuentaMlId: cuenta.id,
          nickname: cuenta.nickname,
          siteId: cuenta.siteId,
          motivoTexto: reclamo.motivo ? (motivos.get(reclamo.motivo) ?? null) : null,
          plazo: plazoDeJugadores(reclamo.jugadores),
        });
      }
    } catch (error) {
      // Solo el nombre del error: nunca el token ni el cuerpo de ML.
      console.warn(`[lib/ml/preguntas] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      cuentasSinRevisar.push({ nickname: cuenta.nickname, motivo: motivoCuentaSinRevisar(error) });
    }
  }

  // Título, precio y stock de lo que ya está importado: sin más llamadas
  // a Mercado Libre.
  const items = [...new Set(preguntas.flatMap((p) => (p.itemId ? [p.itemId] : [])))];
  if (items.length > 0) {
    const filas = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          cuentaMlId: publicaciones.cuentaMlId,
          itemId: publicaciones.publicacionIdExterno,
          titulo: publicaciones.titulo,
          precio: publicaciones.precio,
          stock: publicaciones.stock,
        })
        .from(publicaciones)
        .where(and(eq(publicaciones.empresaId, empresaId), inArray(publicaciones.publicacionIdExterno, items)))
    );
    const porItem = new Map(filas.map((f) => [`${f.cuentaMlId}:${f.itemId}`, f]));
    for (const pregunta of preguntas) {
      const fila = pregunta.itemId ? porItem.get(`${pregunta.cuentaMlId}:${pregunta.itemId}`) : undefined;
      if (fila) {
        pregunta.titulo = fila.titulo;
        pregunta.precio = fila.precio;
        pregunta.stock = fila.stock;
      }
    }
  }

  preguntas.sort(porFecha);
  // El plazo más cercano primero; sin plazo, por antigüedad.
  reclamos.sort((a, b) => compararPlazo(a.plazo, b.plazo) || porFecha(a, b));
  return { preguntas, hayMas, reclamos, cuentasSinRevisar };
}
