// «Portadas Zilonix» — una portada por cada cuenta de Mercado Libre donde
// se publica (decisión de Mateo, 19-nov-2026), todas distintas: a cada
// cuenta se le asigna una PAREJA composición + escena de uso que ninguna
// otra cuenta del mismo producto tiene. 14 composiciones × 8 escenas =
// 112 parejas: alcanza para cualquier cantidad real de cuentas.

import { COMPOSICIONES_PORTADA } from "@/lib/ia/imagen";

// Las 10 de Optimización (se reúsan, no se borran) + 4 nuevas.
export const COMPOSICIONES_PORTADA_ZILONIX: readonly string[] = [
  ...COMPOSICIONES_PORTADA,
  "Producto en vista frontal, ligeramente elevado sobre una superficie blanca con su reflejo suave; escena de uso en un semicírculo detrás, a la altura de la mitad superior.",
  "Producto a la izquierda en ángulo de tres cuartos invertido; a la derecha, dos ventanas verticales apiladas: arriba la escena de uso, abajo un detalle funcional real.",
  "Producto centrado y grande; la escena de uso como un arco suave que lo rodea por arriba; lo que incluye en un arco inferior, cada pieza separada.",
  "Producto en primer plano en la esquina inferior derecha, enorme y nítido; la escena de uso ocupa la esquina superior izquierda con desenfoque y luz cálida.",
];

// Escenas de uso genéricas: la IA las adapta al producto real (siempre
// relacionadas con su función, como pide el texto de Mateo).
export const ESCENAS_USO: readonly string[] = [
  "en el hogar, en un momento cotidiano",
  "en manos de una persona usándolo, en primer plano",
  "al aire libre, con luz natural de día",
  "en un espacio de trabajo o estudio ordenado",
  "en una rutina de la mañana",
  "en un viaje o fuera de casa",
  "en un ambiente de descanso al final del día",
  "en el momento exacto en que se ve su resultado o beneficio",
];

export type Asignacion = { composicion: number; escena: number };

const clave = (a: Asignacion) => `${a.composicion}:${a.escena}`;

// Orden de recorrido: primero cambia la composición (las 14 distintas),
// después la escena. Así 14 cuentas tienen 14 composiciones distintas y,
// de ahí en adelante, se combinan con otra escena.
function parejaEnPosicion(posicion: number): Asignacion {
  const total = COMPOSICIONES_PORTADA_ZILONIX.length;
  return { composicion: posicion % total, escena: Math.floor(posicion / total) % ESCENAS_USO.length };
}

// Asigna una pareja distinta a cada cuenta. `previas` (las que ya tienen
// portada) se respetan tal cual: agregar una cuenta solo asigna la nueva.
export function asignarComposiciones(cuentaIds: string[], previas: Record<string, Asignacion> = {}): Record<string, Asignacion> {
  const resultado: Record<string, Asignacion> = {};
  const usadas = new Set<string>();
  for (const id of cuentaIds) {
    if (previas[id]) {
      resultado[id] = previas[id];
      usadas.add(clave(previas[id]));
    }
  }
  let posicion = 0;
  for (const id of cuentaIds) {
    if (resultado[id]) continue;
    while (usadas.has(clave(parejaEnPosicion(posicion)))) posicion += 1;
    resultado[id] = parejaEnPosicion(posicion);
    usadas.add(clave(resultado[id]));
  }
  return resultado;
}

// «Regenerar» de una cuenta: otra pareja que no use ninguna cuenta del
// mismo producto ni la que ya tenía; si se puede, también otra composición.
export function otraComposicion(cuentaId: string, asignadas: Record<string, Asignacion>): Asignacion {
  const actual = asignadas[cuentaId];
  const usadas = new Set(Object.values(asignadas).map(clave));
  const composicionesUsadas = new Set(Object.values(asignadas).map((a) => a.composicion));
  const total = COMPOSICIONES_PORTADA_ZILONIX.length * ESCENAS_USO.length;
  let respaldo: Asignacion | null = null;
  for (let posicion = 0; posicion < total; posicion++) {
    const p = parejaEnPosicion(posicion);
    if (usadas.has(clave(p))) continue;
    if (!composicionesUsadas.has(p.composicion)) return p;
    if (!respaldo && (!actual || p.composicion !== actual.composicion)) respaldo = p;
  }
  return respaldo ?? actual ?? parejaEnPosicion(0);
}
