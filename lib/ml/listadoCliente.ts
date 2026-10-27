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
import { antiguedadDias, ETIQUETA_APROXIMADO, facturacionMes, ventasMes, vendidosEstimados, type PuntoCalibracionId } from "@/lib/seguimiento/aproximados";

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
  // Issue #235, punto 8 — "% PRIME" del banner estilo Zilonix OS: solo
  // Amazon lo confirma (extension/lectores/amazon.js) — nunca se
  // mezcla con `esFull` (issue #231: "Full" es un programa específico
  // de Mercado Libre, Prime es un concepto distinto de Amazon).
  esPrime: boolean | null;
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

// Issue #262 ("Aproximados estilo Selltrix en los 3 lugares", punto 2)
// — issue #227 (más arriba en este archivo) había dejado "vendidos
// estimados" imposible para Demanda: `ventasMesEst` (lib/ml/estimacionVentas.ts)
// exige date_created real, y un listado nunca lo expone. Ahora SÍ es
// posible para Mercado Libre: cada fila de listado SÍ trae `itemId`
// real (comentario de ProductoListado, arriba) — alcanza para
// interpolar antigüedad por id (lib/seguimiento/aproximados.ts,
// antiguedadDias, la misma tabla de calibración que usa Seguimiento y
// el popup de la extensión). `null` en los 3 campos para cualquier fila
// sin itemId (las 5 plataformas no-ML nunca lo confirman) o sin señal
// "acumulado_sin_periodo" real — nunca inventa un número.
export type EstimacionAproximadaListado = {
  vendidosEst: number | null;
  ventasMesEst: number | null;
  facturacionMesEst: number | null;
};

const SIN_ESTIMACION: EstimacionAproximadaListado = { vendidosEst: null, ventasMesEst: null, facturacionMesEst: null };

export function estimarAproximadosListado(p: ProductoListado, ahora: Date, puntos?: PuntoCalibracionId[]): EstimacionAproximadaListado {
  if (p.itemId == null || p.senalVentas.tipo !== "acumulado_sin_periodo" || p.senalVentas.valor == null) return SIN_ESTIMACION;
  // Un listado nunca confirma el sold_quantity exacto de una tarjeta
  // ajena (issue #251/#250) — el número que trae es siempre el piso
  // "+N vendidos" de la tarjeta, nunca el exacto.
  const vendidosEst = vendidosEstimados(p.senalVentas.valor, { exacto: false, esFull: p.esFull === true });
  if (vendidosEst == null) return SIN_ESTIMACION;
  const dias = antiguedadDias({ dateCreated: null, mlId: p.itemId, recursoMl: "item", ahora, puntos });
  const ventasMesValor = ventasMes(vendidosEst, dias);
  const facturacionMesValor = facturacionMes(ventasMesValor, p.precio);
  return { vendidosEst, ventasMesEst: ventasMesValor, facturacionMesEst: facturacionMesValor };
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

// --- resumen local por bloque, estilo Zilonix OS (issue #235, punto 8) ---
//
// Referencia visual del pedido: el banner de Amazon de Zilonix OS
// (PRODUCTOS ANALIZADOS, PRECIO PROM, RANGO, ESTRELLAS, COMPRADOS/MES,
// % PRIME, DEMANDA VALIDADA). Acá es genérico por diseño (no asume
// Mercado Libre ni Amazon) para poder renderizarse dentro de CUALQUIER
// bloque/desplegable — el panel decide qué KPI mostrar según la
// plataforma del bloque (ej. nunca se muestra "% Prime" en un bloque
// de Mercado Libre, ni "% Full" en uno de Amazon).
export type ResumenLocalBloque = {
  productosAnalizados: number;
  precioPromedio: number | null;
  precioMinimo: number | null;
  precioMaximo: number | null;
  estrellasPromedio: number | null;
  // "Comprados/mes" cuando el bloque tiene al menos una señal
  // mensual_piso real (hoy, solo Amazon); "Acumulado" en cualquier
  // otro caso — nunca se mezclan los dos tipos en un solo número
  // (mismo criterio que calcularResumenBloque).
  volumenEtiqueta: "Comprados/mes" | "Acumulado";
  volumenValor: number | null;
  porcentajeFull: number | null;
  porcentajePrime: number | null;
  // "Demanda validada" — judgment call documentado, no un estándar
  // externo: al menos 5 productos analizados Y al menos un volumen de
  // compras real confirmado (mensual o acumulado) en el bloque. Nunca
  // una visita inventada ni una cifra que `senalVentas` no respalde.
  demandaValidada: boolean;
};

export function calcularResumenLocalBloque(productos: ProductoListado[]): ResumenLocalBloque {
  const resumen = calcularResumenBloque(productos);
  const conCalificacion = productos.filter((p) => p.calificacion != null);
  const estrellasPromedio = conCalificacion.length
    ? Math.round((conCalificacion.reduce((s, p) => s + (p.calificacion as number), 0) / conCalificacion.length) * 10) / 10
    : null;
  const conFull = productos.filter((p) => p.esFull != null);
  const porcentajeFull = conFull.length ? Math.round((conFull.filter((p) => p.esFull).length / conFull.length) * 100) : null;
  const conPrime = productos.filter((p) => p.esPrime != null);
  const porcentajePrime = conPrime.length ? Math.round((conPrime.filter((p) => p.esPrime).length / conPrime.length) * 100) : null;
  const usaMensual = resumen.sumaMensualPiso != null;
  return {
    productosAnalizados: productos.length,
    precioPromedio: resumen.precioPromedio,
    precioMinimo: resumen.precioMinimo,
    precioMaximo: resumen.precioMaximo,
    estrellasPromedio,
    volumenEtiqueta: usaMensual ? "Comprados/mes" : "Acumulado",
    volumenValor: usaMensual ? resumen.sumaMensualPiso : resumen.sumaAcumuladaSinPeriodo,
    porcentajeFull,
    porcentajePrime,
    demandaValidada: productos.length >= 5 && (usaMensual ? resumen.sumaMensualPiso : resumen.sumaAcumuladaSinPeriodo) != null,
  };
}

// --- "Mejor opción para importar" (issue #235, punto 7) ---
//
// Bug real de Zilonix OS que esto evita a propósito (pedido explícito
// de Sharel): "más barato" solo, sin filtro de relevancia, elegía
// cosas como un estuche vacío, una cinta o un puntero — accesorios
// sueltos que coinciden con la categoría pero no son el producto que
// la persona buscó. Acá nunca se considera un candidato que no
// comparta ninguna palabra significativa con el término de búsqueda —
// filtro OBLIGATORIO, antes de cualquier cálculo de balance.
const PALABRAS_VACIAS_RELEVANCIA = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "para",
  "con",
  "sin",
  "y",
  "o",
  "a",
  "en",
  "del",
  "al",
]);

function normalizarPalabra(palabra: string): string {
  return palabra
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function palabrasSignificativas(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map(normalizarPalabra)
    .map((p) => p.replace(/[^a-z0-9]/g, ""))
    .filter((p) => p.length > 2 && !PALABRAS_VACIAS_RELEVANCIA.has(p));
}

// Exportada aparte (no solo usada adentro de mejorOpcionParaImportar)
// para poder probarla sola con casos reales del bug de OS.
export function esRelevanteAlTermino(titulo: string, termino: string): boolean {
  const palabrasTermino = palabrasSignificativas(termino);
  if (!palabrasTermino.length) return true; // término sin palabras útiles (ej. solo stopwords) — no hay con qué filtrar, nunca se descarta todo por esto
  const palabrasTitulo = palabrasSignificativas(titulo);
  if (!palabrasTitulo.length) return false; // título vacío/sin palabras reales — nunca se asume relevante a ciegas
  // Substring en cualquier dirección: cubre singular/plural simple
  // ("reloj"/"relojes") sin necesitar un stemmer completo — mismo
  // criterio pragmático que ya usa lib/ml/variantesBusqueda.ts.
  return palabrasTermino.some((pt) => palabrasTitulo.some((ptt) => ptt.includes(pt) || pt.includes(ptt)));
}

export type MejorOpcionImportar = {
  producto: ProductoListado;
  razon: string;
};

// Balance simple y documentado (nunca "solo el más barato", el bug
// real de OS): precio más bajo, calificación más alta y volumen de
// compras más alto pesan por igual (1/3 cada uno) entre los
// candidatos REALMENTE relevantes al término. Sin calificación -> ni
// premia ni castiga (score neutro 0.5), nunca se trata un "sin dato"
// como 0.
//
// Issue #262, punto 2 (revisión de Pablo) — "revisar cómo se elige el
// volumen": antes comparaba `senalVentas.valor` tal cual (el acumulado
// histórico crudo para Mercado Libre) — bug real de criterio: una
// publicación VIEJA con mucho acumulado le ganaba a una NUEVA que
// vende mucho más rápido por mes, aunque el ritmo reciente sea la
// señal que de verdad importa para decidir qué importar. Ahora, para
// cada candidato, `volumenPara` prefiere ventas/mes ESTIMADAS
// (estimarAproximadosListado — Mercado Libre con itemId y antigüedad
// calibrada) cuando se puede calcular; cae al criterio de siempre
// (mensual_piso real de Amazon, o el acumulado crudo si no hay
// estimación posible) en cualquier otro caso — nunca mezclado sin
// marcar: la razón final siempre aclara cuál de los 3 es, con
// ETIQUETA_APROXIMADO cuando es una estimación.
function volumenPara(p: ProductoListado, ahora: Date, puntos?: PuntoCalibracionId[]): { valor: number; etiqueta: string } {
  if (p.senalVentas.tipo === "mensual_piso") return { valor: p.senalVentas.valor ?? 0, etiqueta: `${p.senalVentas.valor ?? 0} compras/mes` };
  const estimado = estimarAproximadosListado(p, ahora, puntos).ventasMesEst;
  if (estimado != null) return { valor: estimado, etiqueta: `${Math.round(estimado)} ventas/mes (${ETIQUETA_APROXIMADO})` };
  if (p.senalVentas.tipo === "acumulado_sin_periodo") {
    return { valor: p.senalVentas.valor ?? 0, etiqueta: `${p.senalVentas.valor ?? 0} acumulado (sin fecha para estimar /mes todavía)` };
  }
  return { valor: 0, etiqueta: "sin dato de ventas" };
}

export function mejorOpcionParaImportar(productos: ProductoListado[], termino: string, ahora: Date, puntos?: PuntoCalibracionId[]): MejorOpcionImportar | null {
  const relevantes = productos.filter((p) => p.precio > 0 && esRelevanteAlTermino(p.titulo, termino));
  if (!relevantes.length) return null;

  const precios = relevantes.map((p) => p.precio);
  const precioMin = Math.min(...precios);
  const precioMax = Math.max(...precios);
  const rangoPrecio = precioMax - precioMin || 1;

  const volumenes = relevantes.map((p) => volumenPara(p, ahora, puntos).valor);
  const volumenMax = Math.max(...volumenes) || 1;

  let mejor: ProductoListado | null = null;
  let mejorVolumen = { valor: 0, etiqueta: "sin dato de ventas" };
  let mejorScore = -Infinity;
  for (const p of relevantes) {
    const volumen = volumenPara(p, ahora, puntos);
    const scorePrecio = 1 - (p.precio - precioMin) / rangoPrecio; // más barato -> más cerca de 1
    const scoreCalificacion = p.calificacion != null ? p.calificacion / 5 : 0.5;
    const scoreVolumen = volumen.valor / volumenMax;
    const score = scorePrecio / 3 + scoreCalificacion / 3 + scoreVolumen / 3;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = p;
      mejorVolumen = volumen;
    }
  }
  if (!mejor) return null;

  const etiquetaCalificacion = mejor.calificacion != null ? `${mejor.calificacion.toFixed(1)}★` : "sin calificación";
  return {
    producto: mejor,
    razon: `Balance entre precio, calificación (${etiquetaCalificacion}) y volumen de compras (${mejorVolumen.etiqueta}), entre los resultados relevantes a "${termino}".`,
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
