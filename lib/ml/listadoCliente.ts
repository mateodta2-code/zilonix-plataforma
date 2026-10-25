// Issue #227 — "quitar API de Investigación": Demanda/Mercado/Estrategia
// dejan de depender de buscarInvestigacionProducto (lib/ml/investigacion.ts,
// ahora borrado — la API de catálogo de Mercado Libre, confirmado en
// el smoke de Sharel con "calzado", solo traía ~6 publicaciones casi
// todas "Sin dato" contra ~24-40 reales de Selltrix/Zilonix OS). El
// dato real ahora sale SIEMPRE de un listado real escaneado por la
// extensión (issue #221/#225) — este archivo es el ÚNICO lugar con la
// lógica pura (sin I/O) de ese nuevo modelo: tipos, fusión/dedup,
// "Completar vendidos" adaptado, sorts, resumen, KPIs de Mercado y
// Estrategia, y persistencia con TTL. Client-safe a propósito — nunca
// importa lib/ml/cliente.ts ni lib/ml/cuentas.ts (fetch con token,
// Postgres), que nunca pueden entrar al bundle del cliente.
//
// /panel/investigacion/seguimiento NO usa nada de este archivo — sigue
// 100% con la API de Mercado Libre, sin tocar (issue #227, explícito).

import { facturacionEst } from "@/lib/ml/estimacionVentas";

// --- señal de ventas: nunca mezclar un acumulado con una tasa mensual ---
// Mismo criterio que lib/ml/importacionListadoCliente.ts (issue #225) —
// este archivo reemplaza a ese (y a investigacionCliente.ts, issue
// #210): un solo modelo para los 6 "sitios" (Mercado Libre + sus 6
// países, y las 5 plataformas no-ML), nunca dos tipos de producto
// paralelos como antes (API vs. extensión).
export type TipoSenalVentas = "mensual_piso" | "acumulado_sin_periodo" | "ausente";
export type SenalVentas = { valor: number | null; tipo: TipoSenalVentas };

export function clasificarSenalVentas(plataforma: string, vendidos: number | null): SenalVentas {
  if (vendidos == null || !Number.isFinite(vendidos)) return { valor: null, tipo: "ausente" };
  // Único caso real confirmado de "piso mensual" (Amazon, "comprados
  // el mes pasado") — toda otra plataforma (incluida Mercado Libre,
  // cuyo listado solo confirma un acumulado histórico, nunca una
  // fecha de publicación) es acumulado sin período.
  return { valor: vendidos, tipo: plataforma === "Amazon" ? "mensual_piso" : "acumulado_sin_periodo" };
}

export type ProductoListado = {
  plataforma: string;
  // Solo Mercado Libre confirma un itemId real de publicación a nivel
  // listado (issue #227, punto 9 "Seguir solo ML") — null en el resto,
  // nunca inventado.
  itemId: string | null;
  titulo: string;
  precio: number;
  foto: string | null;
  senalVentas: SenalVentas;
  esFull: boolean | null;
  esEnvioGratis: boolean | null;
  calificacion: number | null;
  vendedor: string | null;
  link: string | null;
};

export type Bloque = {
  id: string;
  plataforma: string;
  termino: string;
  queriesUsadas: string[];
  creadoTs: number;
  productos: ProductoListado[];
};

function claveProducto(p: ProductoListado): string {
  return p.link ?? `${p.plataforma}|${p.titulo}`;
}

// Dedup por link (o plataforma+título sin link) — reimportar la misma
// página/variante dos veces nunca infla el total.
export function fusionarProductos(actuales: ProductoListado[], nuevos: ProductoListado[]): ProductoListado[] {
  const vistos = new Set(actuales.map(claveProducto));
  const agregados = nuevos.filter((p) => !vistos.has(claveProducto(p)));
  return [...actuales, ...agregados];
}

// Issue #210, adaptado a este modelo nuevo (antes operaba sobre
// PublicacionInvestigacion, la fila de la API — ahora sobre una fila
// de listado real). "Completar vendidos": cuando el listado de ML no
// confirmó ningún número (senalVentas.tipo === "ausente") pero SÍ hay
// itemId real, la persona puede abrir esa publicación puntual — si la
// extensión confirma sold_quantity ahí, se completa, nunca se pisa un
// dato que el listado ya había confirmado.
export function aplicarVendidosConfirmados(
  productos: ProductoListado[],
  datos: { itemId: string; sold_quantity: number; date_created: string | null; esFull: boolean; etiquetaMasN: boolean }
): ProductoListado[] {
  return productos.map((p) => {
    if (p.itemId !== datos.itemId || p.senalVentas.tipo !== "ausente") return p;
    return { ...p, senalVentas: { valor: datos.sold_quantity, tipo: "acumulado_sin_periodo" } };
  });
}

// --- link seguro (defensa en profundidad, igual que antes) ---
export function linkHttpSeguro(valor: string | null): string | null {
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// --- sorts (issue #227, punto "Sorts OS") ---
export type CriterioOrden = "facturacion" | "vendidos" | "calificacion" | "full" | "precioAsc" | "precioDesc";

// Facturación estimada = precio × señal de ventas, SOLO cuando la
// señal es "mensual_piso" (hoy, únicamente Amazon) — nunca se
// multiplica un acumulado sin período por el precio (eso sería
// exactamente el bug prohibido de tratarlo como una tasa mensual).
// El resto de las filas queda sin este dato, nunca con un número
// inventado.
export function facturacionEstimadaListado(p: ProductoListado): number | null {
  if (p.senalVentas.tipo !== "mensual_piso" || p.senalVentas.valor == null) return null;
  return facturacionEst(p.precio, p.senalVentas.valor);
}

function comparar(a: number | null, b: number | null, desc: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // sin dato siempre al final, nunca mezclado arriba
  if (b == null) return -1;
  return desc ? b - a : a - b;
}

export function ordenarProductos(productos: ProductoListado[], criterio: CriterioOrden): ProductoListado[] {
  const copia = [...productos];
  switch (criterio) {
    case "facturacion":
      return copia.sort((a, b) => comparar(facturacionEstimadaListado(a), facturacionEstimadaListado(b), true));
    case "vendidos":
      return copia.sort((a, b) => comparar(a.senalVentas.valor, b.senalVentas.valor, true));
    case "calificacion":
      return copia.sort((a, b) => comparar(a.calificacion, b.calificacion, true));
    case "full":
      return copia.sort((a, b) => Number(b.esFull === true) - Number(a.esFull === true));
    case "precioAsc":
      return copia.sort((a, b) => comparar(a.precio, b.precio, false));
    case "precioDesc":
      return copia.sort((a, b) => comparar(a.precio, b.precio, true));
    default:
      return copia;
  }
}

// --- resumen (Demanda) ---
export type ResumenBloque = {
  total: number;
  precioMinimo: number | null;
  precioPromedio: number | null;
  precioMaximo: number | null;
  sumaAcumuladaSinPeriodo: number | null;
  sumaMensualPiso: number | null;
};

export function calcularResumenBloque(productos: ProductoListado[]): ResumenBloque {
  const precios = productos.map((p) => p.precio).filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0);
  const acumulados = productos.filter((p) => p.senalVentas.tipo === "acumulado_sin_periodo" && p.senalVentas.valor != null);
  const mensuales = productos.filter((p) => p.senalVentas.tipo === "mensual_piso" && p.senalVentas.valor != null);
  return {
    total: productos.length,
    precioMinimo: precios.length ? Math.min(...precios) : null,
    precioPromedio: precios.length ? Math.round((precios.reduce((a, b) => a + b, 0) / precios.length) * 100) / 100 : null,
    precioMaximo: precios.length ? Math.max(...precios) : null,
    sumaAcumuladaSinPeriodo: acumulados.length ? acumulados.reduce((s, p) => s + (p.senalVentas.valor as number), 0) : null,
    sumaMensualPiso: mensuales.length ? mensuales.reduce((s, p) => s + (p.senalVentas.valor as number), 0) : null,
  };
}

// --- KPIs de Mercado (solo Mercado Libre — Full/envío gratis/vendedor
// son conceptos de ese marketplace, nunca forzados sobre otro) ---
export type KpisMercado = {
  publicacionesEncontradas: number;
  vendedoresDistintos: number;
  precioMinimo: number | null;
  precioPromedio: number | null;
  precioMaximo: number | null;
  porcentajeFull: number | null;
  porcentajeEnvioGratis: number | null;
};

export function calcularKpisMercado(productos: ProductoListado[]): KpisMercado {
  const resumen = calcularResumenBloque(productos);
  const vendedoresDistintos = new Set(productos.map((p) => p.vendedor).filter((v): v is string => Boolean(v))).size;
  const conFull = productos.filter((p) => p.esFull != null);
  const porcentajeFull = conFull.length ? Math.round((conFull.filter((p) => p.esFull).length / conFull.length) * 100) : null;
  const conEnvio = productos.filter((p) => p.esEnvioGratis != null);
  const porcentajeEnvioGratis = conEnvio.length ? Math.round((conEnvio.filter((p) => p.esEnvioGratis).length / conEnvio.length) * 100) : null;
  return {
    publicacionesEncontradas: productos.length,
    vendedoresDistintos,
    precioMinimo: resumen.precioMinimo,
    precioPromedio: resumen.precioPromedio,
    precioMaximo: resumen.precioMaximo,
    porcentajeFull,
    porcentajeEnvioGratis,
  };
}

// --- Estrategia (solo Mercado Libre) ---
// Mismos umbrales de ticket que lib/ml/investigacion.ts (ahora
// borrado) — confirmados, no inventados de nuevo.
const TICKET_ALTO = 64_000;
const TICKET_BAJO = 28_000;

export type ReglaEstrategia = { texto: string };

export function generarEstrategiaListado(args: { publicacionesEncontradas: number; vendedoresDistintos: number; precioPromedio: number | null; porcentajeFull: number | null }): ReglaEstrategia[] {
  const { publicacionesEncontradas, vendedoresDistintos, precioPromedio, porcentajeFull } = args;
  const reglas: ReglaEstrategia[] = [];

  if (publicacionesEncontradas < 3) {
    reglas.push({ texto: `Pocos candidatos encontrados en el listado real (${publicacionesEncontradas}) — puede ser un nicho poco explorado, o que el escaneo no cubrió suficientes variantes. Conviene revisarlo a mano en Mercado Libre antes de decidir.` });
  }

  if (precioPromedio != null && vendedoresDistintos >= 5 && precioPromedio < TICKET_BAJO) {
    reglas.push({ texto: `Mucha competencia (${vendedoresDistintos} vendedores distintos) y ticket bajo (promedio $${precioPromedio.toLocaleString("es-CO")}) — nicho difícil: los márgenes quedan ajustados y hace falta diferenciarse para destacar.` });
  } else if (precioPromedio != null && precioPromedio > TICKET_ALTO) {
    reglas.push({ texto: `Ticket alto (promedio $${precioPromedio.toLocaleString("es-CO")}) — hay margen real para invertir en diferenciación y presentación.` });
  } else if (precioPromedio != null && precioPromedio < TICKET_BAJO) {
    reglas.push({ texto: `Ticket bajo (promedio $${precioPromedio.toLocaleString("es-CO")}) — conviene vender en pack/bundle para subir el ticket promedio sin bajar el precio unitario.` });
  }

  if (porcentajeFull != null) {
    if (porcentajeFull >= 80) {
      reglas.push({ texto: `El ${porcentajeFull}% de los candidatos del listado ya usa Full — entrar sin Full es arrancar en desventaja de visibilidad desde el día uno.` });
    } else if (porcentajeFull <= 20) {
      reglas.push({ texto: `Solo el ${porcentajeFull}% usa Full — activarlo da una ventaja competitiva clara frente al resto.` });
    }
  }

  if (vendedoresDistintos > 0 && vendedoresDistintos <= 2 && publicacionesEncontradas >= 3) {
    reglas.push({ texto: `Solo ${vendedoresDistintos} vendedor(es) distinto(s) concentran el listado real — mercado con pocos jugadores, revisar qué tan fácil es igualarlos antes de entrar.` });
  }

  return reglas;
}

// Issue #227 — a diferencia de lib/ml/investigacion.ts (ahora borrado),
// este veredicto NUNCA clasifica "demanda alta/baja": ese cálculo
// necesitaba ventasMesTotalEstimadas (ventasMesEst, que exige
// date_created real) — un listado nunca expone la fecha de
// publicación, así que esa cuenta ya no es posible sin inventarla.
// Más honesto decir "sin ese dato" que forzar un umbral nuevo sobre un
// acumulado histórico sin período (sería el mismo bug prohibido, solo
// que con otro disfraz). El veredicto queda acotado a competencia real
// (vendedores distintos), que SÍ sale completo del listado.
export function generarVeredictoListado(args: { publicacionesEncontradas: number; vendedoresDistintos: number }): string | null {
  const { publicacionesEncontradas, vendedoresDistintos } = args;
  if (publicacionesEncontradas === 0) return null;
  if (publicacionesEncontradas < 3) {
    return "Pocos candidatos todavía en el listado real para un veredicto confiable — escaneá más variantes o revisá el nicho a mano en Mercado Libre.";
  }
  if (vendedoresDistintos > 0 && vendedoresDistintos <= 2) {
    return "Pocos vendedores distintos en el listado real — mercado con poca competencia, buen momento para evaluar entrar.";
  }
  if (vendedoresDistintos >= 5) {
    return "Mercado con muchos vendedores distintos — nicho competido, hace falta diferenciarse (precio, Full, presentación) para destacar.";
  }
  return "Nicho parejo — ni una oportunidad clara ni un riesgo evidente con los datos reales del listado; revisá el plan de abajo.";
}

// --- persistencia con TTL (issue #227: "sobrevive refresh", "TTL 1h borra") ---
export const TTL_BLOQUE_MS = 60 * 60 * 1000;

function normalizarParaClave(texto: string): string {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function claveStorage(termino: string): string {
  return `zilonix:investigacion-stacks:${normalizarParaClave(termino)}`;
}

// localStorage (no sessionStorage): "sobrevive refresh" y también un
// cierre de pestaña accidental dentro de la misma hora — el TTL real
// es lo que borra, nunca el ciclo de vida de la pestaña.
export function cargarBloques(termino: string): Bloque[] {
  try {
    const crudo = localStorage.getItem(claveStorage(termino));
    if (!crudo) return [];
    const bloques = JSON.parse(crudo) as Bloque[];
    if (!Array.isArray(bloques)) return [];
    const ahora = Date.now();
    return bloques.filter((b) => b && typeof b.creadoTs === "number" && ahora - b.creadoTs < TTL_BLOQUE_MS);
  } catch {
    return [];
  }
}

export function guardarBloques(termino: string, bloques: Bloque[]): void {
  try {
    localStorage.setItem(claveStorage(termino), JSON.stringify(bloques));
  } catch {
    // localStorage lleno/bloqueado (modo privado estricto) — los bloques
    // igual quedan en memoria para esta sesión, solo no sobreviven un refresh.
  }
}
