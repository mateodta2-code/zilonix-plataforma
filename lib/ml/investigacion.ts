import {
  buscarProductosCatalogo,
  linkPublicacion,
  MlSinPermisoAppError,
  obtenerItemMl,
  obtenerMejoresProductosCategoria,
  obtenerOfertasProducto,
  obtenerProducto,
  obtenerVendedor,
  resolverCategoria,
  type OfertaMl,
  type ProductoCatalogoMl,
} from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { creaContador, superaLimite, type ContadorVentana } from "@/lib/limite-peticiones";

// Nueva tarea: traer a Zilonix Seller el módulo "Investigación" de
// Zilonix OS — PARTE 1, solo Mercado Libre Colombia. Estudiado en
// zilonix-os-web (lib/busqueda-productos.js, components/negocio/
// BusquedaProductosPanel.js, InvestigacionPanel.js): analiza un
// producto o nicho ANTES de invertir en él con datos reales de
// Mercado Libre — demanda/competencia, Full, ticket promedio,
// estrategia sugerida.
//
// Diferencia real con el camino "sin extensión" de Zilonix OS, a
// propósito, no un descuido: ese sistema sigue intentando leer
// /visits/items para medir demanda y solo avisa "SIN DATOS DE
// VISITAS" si falla — confirmado en vivo (zilonix-os-web, 9/10) que
// Mercado Libre restringió ese endpoint para publicaciones AJENAS
// (403 siempre, nunca 0 legítimo). Acá no se repite esa llamada
// condenada a fallar: la demanda por visitas/vendidos queda fuera de
// esta Parte 1 (la extensión de Chrome, que es como Zilonix OS
// termina sí consiguiendo "vendidos" real, se deja pendiente — ver
// docs/changelog/pendientes/feat-investigacion-ml.md). Esta Parte 1
// solo muestra lo que la API OFICIAL puede confirmar de verdad:
// cuántas publicaciones de catálogo tienen oferta activa, cuántos
// vendedores distintos, precio mínimo/promedio/máximo, % Full y (si
// Mercado Libre lo manda) % con envío gratis.

const CONCURRENCIA = 5;
const TOPE_PUBLICACIONES = 10; // "las 10 publicaciones más vendidas" del pedido — ver nota de ordenPublicaciones más abajo
const MAX_PAGINAS_TEXTO = 2; // 2×20 = 40 candidatos de texto, de sobra para un Top 10 con margen

// Corrección de Pablo (PR #112): tope de candidatos relevantes ANTES
// de pedir ofertas y vendedores (las dos llamadas caras, una por
// candidato) — sin esto, un término con muchísimos resultados reales
// podía disparar cientos de llamadas a Mercado Libre por una sola
// búsqueda. candidatosPorId ya guarda primero los de texto y recién
// después completa con los de categoría (ver el bucle de abajo), así
// que recortar la lista YA ordenada así prioriza texto > categoría sin
// necesitar ningún criterio nuevo.
const TOPE_CANDIDATOS_RELEVANTES = 40;

// Corrección de Pablo — tope de ids de highlights (categoría) a los
// que se les pide nombre/foto (obtenerProducto) por búsqueda: ese paso
// corría ANTES del tope de arriba (hace falta el nombre para poder
// filtrar por relevancia) y no tenía límite propio, así que en teoría
// podía hacer tantas llamadas como ids mandara el highlights de
// Mercado Libre. Con este tope, el peor caso de una búsqueda queda en
// 2 (texto) + 1 (categoría) + 1 (highlights) + 20 (completar nombre) +
// 40 (ofertas) + 40 (vendedores) = 104 llamadas reales a Mercado Libre.
const TOPE_IDS_CATEGORIA_A_COMPLETAR = 20;

// Mismos umbrales de ticket que ya confirmó Cowork leyendo el código
// real de Selltrix (zilonix-os-web/lib/busqueda-productos.js) — para
// que "ticket alto/bajo" signifique lo mismo en los dos sistemas.
const TICKET_ALTO = 64_000;
const TICKET_BAJO = 28_000;

export class TerminoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TerminoInvalidoError";
  }
}

export class LimiteBusquedasError extends Error {
  constructor() {
    super("Demasiadas búsquedas de Investigación en poco tiempo para esta empresa — esperá un minuto y volvé a intentar.");
    this.name = "LimiteBusquedasError";
  }
}

export class SinCuentaMlError extends Error {
  constructor() {
    super("Esta empresa todavía no tiene ninguna cuenta de Mercado Libre conectada.");
    this.name = "SinCuentaMlError";
  }
}

// Pedido explícito de la tarea: "límite de búsquedas por minuto por
// empresa" — en memoria del proceso, mismo criterio exacto que ya usa
// middleware.ts para IP/usuario (lib/limite-peticiones.ts), aparte de
// esa instancia porque esto no es un límite por request HTTP sino por
// empresa de negocio. 10/min es generoso para un uso humano normal
// (cada búsqueda ya tarda varios segundos por las llamadas reales a
// Mercado Libre) y frena un script que intente automatizar búsquedas
// masivas contra la cuenta conectada de la empresa.
export const LIMITE_BUSQUEDAS_POR_MINUTO = 10;
const VENTANA_BUSQUEDAS_MS = 60_000;
const contadorBusquedas: Map<string, ContadorVentana> = creaContador();

function registrarBusqueda(empresaId: string, ahoraMs: number): void {
  if (superaLimite(contadorBusquedas, empresaId, LIMITE_BUSQUEDAS_POR_MINUTO, VENTANA_BUSQUEDAS_MS, ahoraMs)) {
    throw new LimiteBusquedasError();
  }
}

// Exportado solo para pruebas — sin esto, dos "it" de límite de
// búsquedas se contaminarían entre sí (el contador es un módulo
// compartido, no uno nuevo por test).
export function _reiniciarLimiteBusquedasParaPruebas(): void {
  contadorBusquedas.clear();
}

// "de 2 a 3 palabras" — pedido explícito. Recorta y valida el texto
// con normalizarTextoBusqueda (lib/filtros-listado.ts, compartido con
// el resto de los listados del panel) y agrega el conteo de palabras,
// que es específico de este buscador.
export function validarTermino(crudo: string): string {
  const recortado = normalizarTextoBusqueda(crudo);
  if (!recortado) throw new TerminoInvalidoError("Escribe un producto o nicho para analizar.");
  const palabras = recortado.split(/\s+/).filter(Boolean);
  if (palabras.length < 2 || palabras.length > 3) {
    throw new TerminoInvalidoError('Escribe entre 2 y 3 palabras (ej: "reloj digital").');
  }
  return recortado;
}

function palabrasDistintivas(texto: string): Set<string> {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return new Set(normalizado.split(/[^a-z0-9]+/).filter((p) => p.length >= 3));
}

function compartePalabra(a: Set<string>, b: Set<string>): boolean {
  for (const palabra of a) if (b.has(palabra)) return true;
  return false;
}

async function enLotes<T>(items: T[], concurrencia: number, fn: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrencia, items.length) }, async () => {
      while (indice < items.length) {
        const item = items[indice++];
        await fn(item);
      }
    })
  );
}

export type PublicacionInvestigacion = {
  productId: string;
  itemId: string;
  titulo: string;
  foto: string | null;
  precio: number;
  moneda: string;
  esFull: boolean;
  esEnvioGratis: boolean | null;
  vendedor: string | null;
  esPlatinum: boolean;
  link: string | null;
};

export type ReglaEstrategia = { texto: string };

export type ResultadoInvestigacion = {
  termino: string;
  // Publicaciones de catálogo con al menos una oferta activa real,
  // encontradas para este término — NO es "el total de publicaciones
  // del mercado" (esa cifra sale de la búsqueda de texto pública de
  // Mercado Libre, /sites/MCO/search, que responde 403 a esta
  // aplicación — confirmado en producción en zilonix-os-web,
  // lib/busqueda-productos.js). Se avisa en la pantalla con ese
  // alcance exacto, nunca como si fuera el mercado completo.
  publicacionesEncontradas: number;
  vendedoresDistintos: number;
  precioMinimo: number | null;
  precioPromedio: number | null;
  precioMaximo: number | null;
  porcentajeFull: number | null;
  // null = ninguna oferta real trajo el campo free_shipping (no hay
  // precedente confirmado de este campo contra producción) — nunca se
  // muestra un 0% inventado.
  porcentajeEnvioGratis: number | null;
  publicaciones: PublicacionInvestigacion[]; // Top 10
  estrategiaSugerida: ReglaEstrategia[];
  aviso: string | null;
};

function avisoVacio(termino: string, aviso: string): ResultadoInvestigacion {
  return {
    termino,
    publicacionesEncontradas: 0,
    vendedoresDistintos: 0,
    precioMinimo: null,
    precioPromedio: null,
    precioMaximo: null,
    porcentajeFull: null,
    porcentajeEnvioGratis: null,
    publicaciones: [],
    estrategiaSugerida: [],
    aviso,
  };
}

// Reglas simples y explicadas — nunca un número inventado. Cada regla
// solo se agrega si los datos que necesita de verdad vinieron de la
// API (precioPromedio/porcentajeFull pueden ser null si no hay
// suficientes datos reales, y en ese caso esa regla concreta no se
// agrega, nunca se fuerza un texto genérico sobre un dato ausente).
function generarEstrategia(args: {
  publicacionesEncontradas: number;
  vendedoresDistintos: number;
  precioPromedio: number | null;
  porcentajeFull: number | null;
}): ReglaEstrategia[] {
  const { publicacionesEncontradas, vendedoresDistintos, precioPromedio, porcentajeFull } = args;
  const reglas: ReglaEstrategia[] = [];

  if (publicacionesEncontradas < 3) {
    reglas.push({
      texto: `Pocas publicaciones de catálogo encontradas (${publicacionesEncontradas}) — puede ser un nicho informal (vendedores sin enlazar al catálogo de Mercado Libre) o poco explorado. Conviene revisarlo a mano en Mercado Libre antes de decidir.`,
    });
  }

  if (precioPromedio != null && vendedoresDistintos >= 5 && precioPromedio < TICKET_BAJO) {
    reglas.push({
      texto: `Mucha competencia (${vendedoresDistintos} vendedores distintos) y ticket bajo (promedio $${precioPromedio.toLocaleString("es-CO")}) — nicho difícil: los márgenes quedan ajustados y hace falta diferenciarse para destacar.`,
    });
  } else if (precioPromedio != null && precioPromedio > TICKET_ALTO) {
    reglas.push({
      texto: `Ticket alto (promedio $${precioPromedio.toLocaleString("es-CO")}) — hay margen real para invertir en diferenciación y presentación.`,
    });
  } else if (precioPromedio != null && precioPromedio < TICKET_BAJO) {
    reglas.push({
      texto: `Ticket bajo (promedio $${precioPromedio.toLocaleString("es-CO")}) — conviene vender en pack/bundle para subir el ticket promedio sin bajar el precio unitario.`,
    });
  }

  if (porcentajeFull != null) {
    if (porcentajeFull >= 80) {
      reglas.push({ texto: `El ${porcentajeFull}% de las publicaciones encontradas ya usa Full — entrar sin Full es arrancar en desventaja de visibilidad desde el día uno.` });
    } else if (porcentajeFull <= 20) {
      reglas.push({ texto: `Solo el ${porcentajeFull}% usa Full — activarlo da una ventaja competitiva clara frente al resto.` });
    }
  }

  if (vendedoresDistintos > 0 && vendedoresDistintos <= 2 && publicacionesEncontradas >= 3) {
    reglas.push({
      texto: `Solo ${vendedoresDistintos} vendedor(es) distinto(s) concentran las publicaciones encontradas — mercado con pocos jugadores, revisar qué tan fácil es igualarlos antes de entrar.`,
    });
  }

  return reglas;
}

function ordenPublicaciones(a: PublicacionInvestigacion, b: PublicacionInvestigacion): number {
  // Sin "vendidos" real disponible por API oficial (ver nota de
  // SinVendidosDisponibles en el changelog), el Top 10 no puede
  // ordenarse por ventas — se ordena por precio descendente solo para
  // que el orden sea determinístico, nunca se etiqueta como "más
  // vendidas" en la pantalla.
  return b.precio - a.precio;
}

// Calcula KPIs + estrategia + aviso a partir de ofertas YA resueltas —
// sin ningún I/O (ni fetch ni base de datos), para poder probar los
// cálculos (precio, % Full, respuestas incompletas) sin simular toda
// la cadena de llamadas a Mercado Libre.
export function calcularResultadoInvestigacion(termino: string, publicaciones: PublicacionInvestigacion[]): ResultadoInvestigacion {
  if (!publicaciones.length) {
    return avisoVacio(
      termino,
      `No se encontraron publicaciones activas de "${termino}" en el catálogo de Mercado Libre — probá con otro término más específico, o puede ser un nicho donde los vendedores no enlazan sus publicaciones al catálogo.`
    );
  }

  const precios = publicaciones.map((p) => p.precio).filter((p) => p > 0);
  const precioMinimo = precios.length ? Math.min(...precios) : null;
  const precioMaximo = precios.length ? Math.max(...precios) : null;
  const precioPromedio = precios.length ? Math.round(precios.reduce((s, p) => s + p, 0) / precios.length) : null;

  const porcentajeFull = Math.round((publicaciones.filter((p) => p.esFull).length / publicaciones.length) * 100);

  const conDatoEnvio = publicaciones.filter((p) => p.esEnvioGratis !== null);
  const porcentajeEnvioGratis = conDatoEnvio.length ? Math.round((conDatoEnvio.filter((p) => p.esEnvioGratis).length / conDatoEnvio.length) * 100) : null;

  const vendedoresDistintos = new Set(publicaciones.map((p) => p.vendedor).filter((v): v is string => Boolean(v))).size;

  const top10 = [...publicaciones].sort(ordenPublicaciones).slice(0, TOPE_PUBLICACIONES);

  return {
    termino,
    publicacionesEncontradas: publicaciones.length,
    vendedoresDistintos,
    precioMinimo,
    precioPromedio,
    precioMaximo,
    porcentajeFull,
    porcentajeEnvioGratis,
    publicaciones: top10,
    estrategiaSugerida: generarEstrategia({ publicacionesEncontradas: publicaciones.length, vendedoresDistintos, precioPromedio, porcentajeFull }),
    aviso: null,
  };
}

type ResultadoOfertaCandidato = { publicacion: PublicacionInvestigacion | null; sinPermiso: boolean };

// Issue #147 — distingue "este candidato no tiene ofertas reales"
// (publicacion: null, sinPermiso: false — legítimo, pasa seguido) de
// "Mercado Libre no deja ver las ofertas de este candidato"
// (sinPermiso: true, MlSinPermisoAppError) — el llamador necesita la
// diferencia para poder avisar "falta permiso" en vez de "no se
// encontró nada" cuando TODOS los candidatos caen en el segundo caso.
async function resolverOfertaDeUnCandidato(candidato: ProductoCatalogoMl, token: string, cacheVendedores: Map<string, ReturnType<typeof obtenerVendedor>>): Promise<ResultadoOfertaCandidato> {
  let ofertas: OfertaMl[];
  try {
    ofertas = await obtenerOfertasProducto(candidato.id, token);
  } catch (e) {
    if (e instanceof MlSinPermisoAppError) return { publicacion: null, sinPermiso: true };
    throw e; // 401/5xx/timeout — no es "este candidato puntual", sube.
  }
  const oferta = ofertas[0];
  if (!oferta) return { publicacion: null, sinPermiso: false };

  let vendedor: Awaited<ReturnType<typeof obtenerVendedor>> = null;
  if (oferta.sellerId) {
    if (!cacheVendedores.has(oferta.sellerId)) cacheVendedores.set(oferta.sellerId, obtenerVendedor(oferta.sellerId, token));
    vendedor = await cacheVendedores.get(oferta.sellerId)!;
  }

  return {
    publicacion: {
      productId: candidato.id,
      itemId: oferta.itemId,
      titulo: candidato.nombre || `Publicación ${oferta.itemId}`,
      foto: candidato.foto,
      precio: oferta.precio,
      moneda: oferta.monedaId,
      esFull: oferta.esFull,
      esEnvioGratis: oferta.esEnvioGratis,
      vendedor: vendedor?.nickname ?? null,
      esPlatinum: vendedor?.esPlatinum ?? false,
      link: linkPublicacion(oferta.itemId),
    },
    sinPermiso: false,
  };
}

// Orquesta la búsqueda real contra Mercado Libre: valida el término,
// aplica el límite de búsquedas por empresa, resuelve la cuenta ML
// conectada de la empresa (dbComoEmpresa + empresaId, como pide la
// tarea), busca candidatos por texto + categoría, los filtra por
// relevancia y resuelve sus ofertas reales. El cálculo de KPIs y
// estrategia vive aparte (calcularResultadoInvestigacion), para poder
// probarlo sin repetir toda esta cadena.
export async function buscarInvestigacionProducto(empresaId: string, terminoCrudo: string, ahoraMs: number = Date.now()): Promise<ResultadoInvestigacion> {
  // Issue #147 — orden invertido: antes registrarBusqueda() (que
  // descuenta cupo del límite de 10/minuto) corría ANTES de validar el
  // término — un término inválido ("a", 4+ palabras) gastaba cupo real
  // sin haber hecho ninguna búsqueda de verdad.
  const termino = validarTermino(terminoCrudo);
  registrarBusqueda(empresaId, ahoraMs);

  const cuenta = await obtenerCuentaMlActiva(empresaId);
  if (!cuenta) throw new SinCuentaMlError();
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);

  // Paginación secuencial (cada offset depende de cuántos resultados
  // trajo la página anterior) — enLotes no aplica acá, se deja el
  // bucle simple y directo.
  const candidatosPorId = new Map<string, ProductoCatalogoMl>();
  for (let pagina = 0; pagina < MAX_PAGINAS_TEXTO; pagina++) {
    const candidatos = await buscarProductosCatalogo(termino, token, pagina * 20);
    candidatos.forEach((c) => {
      if (!candidatosPorId.has(c.id)) candidatosPorId.set(c.id, c);
    });
    if (candidatos.length < 20) break;
  }

  // Issue #147, bug real: highlights devuelve PRODUCT (catálogo, va a
  // obtenerProducto/GET /products/{id}), ITEM (una publicación real,
  // necesita GET /items/{id} — endpoint DISTINTO, obtenerProducto le
  // daba 404 siempre) y USER_PRODUCT (id "MCOU...", no es ni catálogo
  // ni una publicación consultable igual — se ignora a propósito, se
  // cuenta solo para no perder de vista cuántos se descartaron).
  let destacadosIgnorados = 0;
  const categoria = await resolverCategoria(termino, token);
  if (categoria) {
    const destacados = await obtenerMejoresProductosCategoria(categoria.categoryId, token);
    const porCompletar = destacados.filter((d) => !candidatosPorId.has(d.id)).slice(0, TOPE_IDS_CATEGORIA_A_COMPLETAR);
    await enLotes(porCompletar, CONCURRENCIA, async (destacado) => {
      if (destacado.tipo === "USER_PRODUCT") {
        destacadosIgnorados++;
        return;
      }
      const info = destacado.tipo === "ITEM" ? await obtenerItemMl(destacado.id, token) : await obtenerProducto(destacado.id, token);
      if (info) candidatosPorId.set(destacado.id, info);
    });
  }
  if (destacadosIgnorados > 0) {
    console.warn(`[lib/ml/investigacion] "${termino}": ${destacadosIgnorados} destacado(s) USER_PRODUCT ignorado(s) (no son catálogo ni publicación consultable igual).`);
  }

  if (!candidatosPorId.size) {
    return avisoVacio(
      termino,
      `No se encontró ningún producto de catálogo activo para "${termino}" en Mercado Libre. Puede ser un nicho muy informal donde los vendedores no enlazan sus publicaciones al catálogo — probá con otro término más específico.`
    );
  }

  const palabrasBusqueda = palabrasDistintivas(termino);
  const relevantes = [...candidatosPorId.values()]
    .filter((c) => c.nombre && compartePalabra(palabrasDistintivas(c.nombre), palabrasBusqueda))
    .slice(0, TOPE_CANDIDATOS_RELEVANTES);

  if (!relevantes.length) {
    return avisoVacio(termino, `"${termino}" no coincide con ningún producto real del catálogo de Mercado Libre — probá con otro término.`);
  }

  const cacheVendedores = new Map<string, ReturnType<typeof obtenerVendedor>>();
  const publicaciones: PublicacionInvestigacion[] = [];
  let sinOfertas = 0;
  let sinPermisoOfertas = 0;
  await enLotes(relevantes, CONCURRENCIA, async (candidato) => {
    const { publicacion, sinPermiso } = await resolverOfertaDeUnCandidato(candidato, token, cacheVendedores);
    if (publicacion) publicaciones.push(publicacion);
    else if (sinPermiso) sinPermisoOfertas++;
    else sinOfertas++;
  });

  // Issue #147 — si TODAS las ofertas fallaron por falta de permiso de
  // la app (nunca mezclado con "sin ofertas reales", que es un caso
  // legítimo y distinto), el aviso lo dice tal cual en vez de "no se
  // encontró nada" — pedido explícito, para que quede claro que hay
  // que avisarle al administrador, no que el nicho esté vacío.
  if (!publicaciones.length && sinPermisoOfertas === relevantes.length) {
    return avisoVacio(termino, "Mercado Libre no le da permiso a la app para ver ofertas; avisale al administrador.");
  }

  if (!publicaciones.length && sinOfertas + sinPermisoOfertas === relevantes.length) {
    return avisoVacio(
      termino,
      `"${termino}" existe en el catálogo de Mercado Libre, pero ninguno de sus productos tiene publicaciones activas enlazadas — pasa en nichos donde los vendedores publican sin usar el catálogo.`
    );
  }

  return calcularResultadoInvestigacion(termino, publicaciones);
}
