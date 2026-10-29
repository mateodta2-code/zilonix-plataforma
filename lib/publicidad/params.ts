// Issue #255 — el periodo y el orden viven en la URL. El nombre que
// llega en el query nunca se usa como columna de SQL: resolverOrden
// solo acepta la lista blanca de kpis.ts.

import { hoyBogota } from "@/lib/publicidad/plan";
import {
  resolverDireccion,
  resolverOrden,
  resolverPeriodo,
  type ColumnaOrden,
  type DireccionOrden,
  type Periodo,
} from "@/lib/publicidad/kpis";
import { nombreMes } from "@/lib/publicidad/formato";
import { ROTULO_PERIODO } from "@/lib/publicidad/rotulos";

export type ParametrosPublicidad = {
  periodo: Periodo;
  orden: ColumnaOrden;
  dir: DireccionOrden;
  incluirPausadas: boolean;
};

export function leerParametrosPublicidad(
  entrada: { mes?: string | null; orden?: string | null; dir?: string | null; pausadas?: string | null },
  ahora: Date
): ParametrosPublicidad {
  const periodo = resolverPeriodo(entrada.mes, ahora);
  const orden = resolverOrden(entrada.orden);
  return {
    periodo,
    orden,
    dir: resolverDireccion(entrada.dir, orden),
    incluirPausadas: entrada.pausadas === "1",
  };
}

export type HrefPublicidad = {
  cuenta?: string | null;
  mes?: string | null;
  orden?: ColumnaOrden | null;
  dir?: DireccionOrden | null;
  pausadas?: boolean;
  aviso?: string | null;
};

export function hrefPublicidad(params: HrefPublicidad): string {
  const q = new URLSearchParams();
  const orden = params.orden ?? "inversion";
  const dirPorDefecto = orden === "campana" ? "asc" : "desc";
  if (params.cuenta) q.set("cuenta", params.cuenta);
  if (params.mes) q.set("mes", params.mes);
  if (params.orden && params.orden !== "inversion") q.set("orden", params.orden);
  if (params.dir && params.dir !== dirPorDefecto) q.set("dir", params.dir);
  if (params.pausadas) q.set("pausadas", "1");
  if (params.aviso) q.set("aviso", params.aviso);
  const texto = q.toString();
  return texto ? `/panel/publicidad?${texto}` : "/panel/publicidad";
}

export type OpcionMes = { valor: string; rotulo: string };

// Cuatro meses hacia atrás: la API de Product Ads guarda 90 días, y un
// mes más viejo simplemente no tiene filas (la pantalla lo dice con "—").
const MESES_ELEGIBLES = 4;

export function opcionesDeMes(ahora: Date, seleccionado: string): OpcionMes[] {
  const hoy = hoyBogota(ahora);
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const opciones: OpcionMes[] = [];
  for (let i = 0; i < MESES_ELEGIBLES; i++) {
    let mm = mes - i;
    let aa = anio;
    while (mm < 1) {
      mm += 12;
      aa -= 1;
    }
    const valor = `${aa}-${String(mm).padStart(2, "0")}`;
    const rotulo = i === 0 ? ROTULO_PERIODO.mesEnCurso : i === 1 ? ROTULO_PERIODO.mesAnterior : nombreMes(aa, mm);
    opciones.push({ valor, rotulo });
  }
  if (!opciones.some((o) => o.valor === seleccionado)) {
    const aa = Number(seleccionado.slice(0, 4));
    const mm = Number(seleccionado.slice(5, 7));
    opciones.push({ valor: seleccionado, rotulo: nombreMes(aa, mm) });
  }
  return opciones;
}
