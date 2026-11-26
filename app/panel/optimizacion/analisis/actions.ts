"use server";

import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { MAXIMO_DIAS_VISITAS, PATRON_ID_PRODUCTO_O_ITEM, visitasPorDiaMl } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { recortarPeriodo, sumarVisitas, ultimosDiasParaVisitas } from "@/lib/optimizacion/analisisDatos";
import { leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { hoyBogota } from "@/lib/publicidad/plan";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Visitas de unas pocas publicaciones en los dos períodos (solo GET a
// Mercado Libre, /items/{id}/visits/time_window: una llamada por publicación
// cubre los dos períodos). El cliente la llama en tandas de 3: el tope por
// llamada es lo que limita el paralelismo contra Mercado Libre.
export const PUBLICACIONES_POR_TANDA = 3;

export type VisitasPublicacion = { actual: number; anterior: number } | null;

export type ResultadoVisitasAnalisis = { ok: true; visitas: Record<string, VisitasPublicacion> } | { ok: false; error: string };

type EntradaPeriodo = { dias?: string; periodo?: string; desde?: string; hasta?: string };

export async function visitasPublicacionesAnalisisAction(cuentaMlId: string, itemIds: string[], entrada: EntradaPeriodo): Promise<ResultadoVisitasAnalisis> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return { ok: false, error: "Sin sesión." };
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return { ok: false, error: "Sin empresa." };
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, error: "Sin permiso." };
    throw error;
  }

  if (typeof cuentaMlId !== "string" || !Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > PUBLICACIONES_POR_TANDA) {
    return { ok: false, error: "Solicitud inválida." };
  }
  const ids = [...new Set(itemIds)];
  if (!ids.every((id) => typeof id === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(id))) return { ok: false, error: "Solicitud inválida." };

  // La cuenta tiene que ser de ESTA empresa y seguir conectada.
  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaMlId && !c.desconectadaTs);
  if (!cuenta) return { ok: false, error: "Cuenta no disponible." };

  // El período se recalcula en el servidor con la misma lista blanca de la página.
  const ahora = new Date();
  const periodo = recortarPeriodo(leerPeriodoLista({ dias: entrada?.dias, periodo: entrada?.periodo, desde: entrada?.desde, hasta: entrada?.hasta }, ahora));
  const ultimosDias = ultimosDiasParaVisitas(periodo, hoyBogota(ahora), MAXIMO_DIAS_VISITAS);
  // Más viejo de lo que Mercado Libre entrega: no se inventa, queda en «—».
  if (ultimosDias === null) return { ok: true, visitas: Object.fromEntries(ids.map((id) => [id, null])) };

  const token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
  const resultados = await Promise.all(
    ids.map(async (id): Promise<[string, VisitasPublicacion]> => {
      try {
        const porDia = await visitasPorDiaMl(id, token, ultimosDias);
        if (!porDia) return [id, null];
        return [id, { actual: sumarVisitas(porDia, periodo.desde, periodo.hasta), anterior: sumarVisitas(porDia, periodo.anteriorDesde, periodo.anteriorHasta) }];
      } catch (error) {
        // Solo el nombre del error: nada de respuestas de Mercado Libre en logs.
        console.warn(`[app/panel/optimizacion/analisis] visitas ${id}: ${error instanceof Error ? error.name : "error"}`);
        return [id, null];
      }
    })
  );
  return { ok: true, visitas: Object.fromEntries(resultados) };
}
