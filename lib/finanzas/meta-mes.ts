import { leerMetaMensual, guardarMetaMensual } from "@/lib/metas-mensuales";
import { requiereDueno, requierePermiso } from "@/lib/permisos";
import { avanceMeta, diasDelMes, type AvanceMeta } from "./meta-avance";
import { tramosBogota } from "./tablero";
import type { Indicadores } from "./indicadores";

// Inicio (Sharel y el equipo, 13-nov; #125/#126) — la meta del mes en
// curso y su avance en utilidad DESPUÉS de publicidad. Ver pide
// finanzas.consultar; fijarla, finanzas.modificar y ser el Dueño.

export type MetaDelMes = {
  mes: string; // AAAA-MM-01
  // null = el mes no tiene meta («Sin meta para este mes», nunca 0).
  meta: string | null;
  actualizadaTs: Date | null;
  // null si no hay meta o la utilidad del mes es «—».
  avance: AvanceMeta | null;
};

export function primerDiaDelMes(ahora: Date): string {
  return `${tramosBogota(ahora).actual.desdeTexto.slice(0, 7)}-01`;
}

// `delMes` = los indicadores del mes en curso (día 1 hasta hoy).
export async function leerMetaDelMes(empresaId: string, usuarioId: string, ahora: Date, delMes: Indicadores): Promise<MetaDelMes> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const mes = primerDiaDelMes(ahora);
  const fila = await leerMetaMensual(empresaId, mes);
  const meta = fila?.metaUtilidad ?? null;
  const avance =
    meta === null || delMes.utilidadDespues === null
      ? null
      : avanceMeta({ meta, logrado: delMes.utilidadDespues, diasTranscurridos: delMes.tramo.dias, diasMes: diasDelMes(mes) });
  return { mes, meta, actualizadaTs: fila?.actualizadaTs ?? null, avance };
}

// Solo el Dueño. El monto llega ya leído (texto, sin Number).
export async function fijarMetaDelMes(empresaId: string, usuarioId: string, ahora: Date, metaUtilidad: string): Promise<{ id: string }> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  await requiereDueno(usuarioId, empresaId);
  return guardarMetaMensual({ empresaId, usuarioId, mes: primerDiaDelMes(ahora), metaUtilidad });
}
