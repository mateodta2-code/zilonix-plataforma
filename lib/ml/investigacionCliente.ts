// Issue #210 — "Completar vendidos": cuando la extensión de Zilonix
// confirma un sold_quantity real para un candidato que la API de
// Mercado Libre había devuelto sin ese dato, el panel de Investigación
// (app/panel/investigacion/PanelDemanda.tsx, Client Component) tiene
// que recalcular columna Vendidos, fact. est./mes, los 3 KPIs de
// Demanda y el orden — en el NAVEGADOR, sin otro viaje al servidor.
//
// Por qué este archivo existe separado de lib/ml/investigacion.ts (que
// ya tiene calcularResultadoInvestigacion, el cálculo real y probado):
// ese archivo importa lib/ml/cliente.ts y lib/ml/cuentas.ts (fetch a
// Mercado Libre con el token de la cuenta, acceso a Postgres) — nunca
// puede entrar al bundle del cliente. Acá solo vive la porción PURA
// (sin I/O) que de verdad cambia con un dato de la extensión.
import { facturacionEst, ventasMesEst } from "@/lib/ml/estimacionVentas";
import type { PublicacionInvestigacion } from "@/lib/ml/investigacion";

// Payload que manda extension/marcador-zilonix.js (reenviado por
// extension/background.js desde la pestaña de Mercado Libre donde se
// abrió el candidato) — nombres de campo acordados con la extensión,
// ver extension/LEEME.md. `sold_quantity`/`date_created` en snake_case
// a propósito: son los nombres reales del JSON de Mercado Libre que la
// extensión lee tal cual, nunca traducidos a mitad de camino.
export type VendidosExtension = {
  itemId: string;
  sold_quantity: number;
  date_created: string | null;
  esFull: boolean;
  etiquetaMasN: boolean;
};

// Nunca pisa un vendidos que ya vino real de la API — "completar" es
// solo para lo que la API dejó en null, nunca para "corregir" un dato
// que Mercado Libre ya confirmó por su cuenta oficial.
export function aplicarVendidosExtension(publicaciones: PublicacionInvestigacion[], datos: VendidosExtension): PublicacionInvestigacion[] {
  return publicaciones.map((p) => {
    if (p.itemId !== datos.itemId || p.vendidos != null) return p;
    const ventasMesEstimadas = ventasMesEst(datos.sold_quantity, datos.date_created, { esFull: datos.esFull, etiquetaMasN: datos.etiquetaMasN });
    const facturacionMesEstimada = facturacionEst(p.precio, ventasMesEstimadas);
    return { ...p, vendidos: datos.sold_quantity, ventasMesEstimadas, facturacionMesEstimada };
  });
}

// Mismo criterio que ordenPublicaciones (lib/ml/investigacion.ts, no
// exportada): con dato real siempre antes que sin dato, y entre las que
// sí tienen, la de más vendidos primero; sin dato real, precio
// descendente como único criterio determinístico que queda.
export function ordenarPorVendidos(publicaciones: PublicacionInvestigacion[]): PublicacionInvestigacion[] {
  return [...publicaciones].sort((a, b) => {
    if (a.vendidos != null && b.vendidos != null) return b.vendidos - a.vendidos;
    if (a.vendidos != null) return -1;
    if (b.vendidos != null) return 1;
    return b.precio - a.precio;
  });
}

export type KpisDemanda = {
  vendidosTotalesReales: number | null;
  publicacionesConVendidosReal: number;
  promedioVendidosPorPublicacion: number | null;
  facturacionMesTotalEstimada: number | null;
};

// `base` son los KPIs que ya mandó el servidor — calculados sobre
// TODAS las publicaciones encontradas, no solo el Top 10 que se ve en
// esta pantalla. `completadasPorExtension` son las filas del Top 10
// que la extensión completó en esta sesión (antes sin dato, ahora con
// vendidos real vía aplicarVendidosExtension) — cada una suma su
// aporte una sola vez. A propósito NUNCA se recalcula desde cero sobre
// el Top 10 solo: eso cambiaría en silencio el denominador real
// (publicacionesEncontradas, que puede ser mucho mayor que 10).
export function combinarKpisConCompletados(base: KpisDemanda, completadasPorExtension: PublicacionInvestigacion[]): KpisDemanda {
  if (!completadasPorExtension.length) return base;

  const sumaVendidosNuevos = completadasPorExtension.reduce((s, p) => s + (p.vendidos ?? 0), 0);
  const sumaFacturacionNueva = completadasPorExtension.reduce((s, p) => s + (p.facturacionMesEstimada ?? 0), 0);

  const publicacionesConVendidosReal = base.publicacionesConVendidosReal + completadasPorExtension.length;
  const vendidosTotalesReales = (base.vendidosTotalesReales ?? 0) + sumaVendidosNuevos;
  const promedioVendidosPorPublicacion = publicacionesConVendidosReal > 0 ? Math.round((vendidosTotalesReales / publicacionesConVendidosReal) * 10) / 10 : null;
  const facturacionMesTotalEstimada = (base.facturacionMesTotalEstimada ?? 0) + sumaFacturacionNueva;

  return { vendidosTotalesReales, publicacionesConVendidosReal, promedioVendidosPorPublicacion, facturacionMesTotalEstimada };
}
