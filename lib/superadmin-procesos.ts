// Estado de los procesos para /superadmin/procesos (25-nov) — lógica pura
// (sin base ni Next), como lib/superadmin-salud.ts. La lectura está en
// lib/superadmin.ts (listarEstadoProcesos) y la escritura en
// lib/trabajos/registroEjecuciones.ts.
import type { Proceso } from "./trabajos/registroEjecuciones";

export type EstadoProceso = {
  proceso: Proceso;
  ultimaTs: Date | null;
  ultimaOk: boolean | null;
  ultimoResumen: Record<string, number>;
  ultimoError: string | null;
  ultimaExitosaTs: Date | null;
  corridas24h: number;
  fallidas24h: number;
};

export type Semaforo = "al_dia" | "atrasado" | "fallo" | "sin_datos";

type Info = { nombre: string; queHace: string; cadaCuanto: string; minutosMaximos: number };

// minutosMaximos: pasado ese tiempo sin una corrida, el proceso sale
// «Atrasado». Cada uno con margen sobre su programación real:
// - avisos: el cron de Railway lo llama cada 5 min → 15 min (3 vueltas).
// - publicidad: cron de GitHub cada hora, que GitHub retrasa → 3 h.
// - seguimiento: varias rondas al día (8-13 h y 20-23 h UTC) → 26 h.
export const INFO_PROCESOS: Record<Proceso, Info> = {
  avisos_ml: {
    nombre: "Avisos de Mercado Libre",
    queHace: "Procesa los avisos que manda Mercado Libre (ventas, envíos, cambios en publicaciones).",
    cadaCuanto: "cada 5 minutos",
    minutosMaximos: 15,
  },
  publicidad: {
    nombre: "Publicidad",
    queHace: "Sincroniza las campañas y métricas de Product Ads de cada cuenta.",
    cadaCuanto: "cada hora",
    minutosMaximos: 3 * 60,
  },
  seguimiento: {
    nombre: "Seguimiento",
    queHace: "Revisa una vez al día las publicaciones en seguimiento y crea las alertas.",
    cadaCuanto: "varias veces al día",
    minutosMaximos: 26 * 60,
  },
};

export function semaforoDe(p: EstadoProceso, ahora: Date): Semaforo {
  if (!p.ultimaTs) return "sin_datos";
  if (p.ultimaOk === false) return "fallo";
  const minutos = (ahora.getTime() - p.ultimaTs.getTime()) / 60_000;
  return minutos > INFO_PROCESOS[p.proceso].minutosMaximos ? "atrasado" : "al_dia";
}

export const ETIQUETA_SEMAFORO: Record<Semaforo, string> = {
  al_dia: "Al día",
  atrasado: "Atrasado",
  fallo: "Falló",
  sin_datos: "Sin datos",
};

// Nombres en español de los conteos que devuelve cada proceso. Una clave
// que no esté acá se muestra tal cual (no se pierde).
const ETIQUETAS_RESUMEN: Record<string, string> = {
  // avisos (lib/ml/trabajador.ts)
  recibidosPendientes: "Tomados de la cola",
  procesados: "Procesados",
  fallidos: "Con error",
  omitidosSuspendida: "Omitidos (empresa suspendida)",
  omitidosSinCuenta: "Omitidos (cuenta no conectada)",
  omitidosViejos: "Omitidos (viejos, no de venta)",
  lotes: "Lotes",
  // publicidad (lib/trabajos/sincronizarPublicidad.ts)
  revisadas: "Cuentas revisadas",
  procesadas: "Sincronizadas",
  saltadas: "Saltadas (al día)",
  fallidas: "Con error",
  pendientes: "Pendientes",
  // seguimiento (lib/trabajos/revisionDiariaSeguimiento.ts)
  activos: "Seguimientos activos",
  saltados: "Saltados",
  suspendidos: "Omitidos (empresa suspendida)",
  alertasCreadas: "Alertas creadas",
};

export function etiquetaResumen(clave: string): string {
  return ETIQUETAS_RESUMEN[clave] ?? clave;
}

// «hace 3 min», «hace 2 h», «hace 1 día». Para la pantalla; la hora
// exacta va al lado.
export function haceCuanto(ts: Date, ahora: Date): string {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - ts.getTime()) / 60_000));
  if (minutos < 1) return "hace menos de 1 min";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}
