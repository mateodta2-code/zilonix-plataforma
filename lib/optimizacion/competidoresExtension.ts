// Optimización, Fase 4 fuera del catálogo — competidores que la
// extensión encuentra buscando el producto en Mercado Libre y leyendo
// cada ficha (extension/background.js, "Buscar 10 competidores"). Puro:
// valida lo que llega por postMessage (nunca se confía en el mensaje),
// arma el término de búsqueda y las alertas. Un dato que la ficha no
// mostró queda en null y no genera alerta.

import { alertasComparacion, type FilaComparacion } from "@/lib/optimizacion/competencia";

// Competidores guardados por publicación: los 10 de la búsqueda más los
// que la persona agrega por link (los guardados se conservan al buscar
// de nuevo).
export const MAXIMO_COMPETIDORES_EXTENSION = 30;

export type CompetidorExtension = {
  itemId: string | null;
  link: string;
  titulo: string | null;
  foto: string | null;
  vendedor: string | null;
  precio: number | null;
  precioAnterior: number | null;
  descuentoPorcentaje: number | null;
  vendidos: number | null;
  vendidosExacto: boolean | null;
  calificacion: number | null;
  numeroOpiniones: number | null;
  esCatalogo: boolean | null;
  full: boolean | null;
  envioGratis: boolean | null;
  inventario: number | null;
  inventarioAproximado: boolean;
  fotos: number | null;
  descripcion: boolean | null;
  vendidosEstimados: number | null;
  antiguedadDias: number | null;
  ventasMes: number | null;
  facturacionMes: number | null;
  // false = la ficha no se pudo leer (tope de 15 s); solo trae lo que
  // mostraba el listado.
  leidoDeFicha: boolean;
  // true = la persona lo agregó por link (o lo dejó fijo): se conserva
  // cuando se vuelve a buscar.
  manual: boolean;
  // Última vez que se leyó su ficha de verdad (ISO). null = nunca.
  actualizadoTs: string | null;
};

export type MensajeCompetidores =
  | { tipo: "ok"; itemId: string; termino: string; modo: "busqueda" | "links"; candidatos: number; competidores: CompetidorExtension[] }
  | { tipo: "error"; itemId: string; razon: string };

// Mismo dominio anclado que la extensión (PATRON_DOMINIO_IMPORTAR_LINK_PERMITIDO).
const PATRON_LINK_ML = /^https:\/\/([a-z0-9-]+\.)*mercado(libre\.(com\.co|com\.ar|com\.mx|cl|com\.uy|com\.pe)|livre\.com\.br)\//i;
const PATRON_ITEM_ID = /^[A-Z]{3}\d{6,15}$/;

const PAIS_POR_SITIO: Record<string, string> = { MCO: "CO", MLA: "AR", MLB: "BR", MLM: "MX", MLC: "CL", MLU: "UY", MPE: "PE" };

export function paisDeSitio(siteId: string): string {
  return PAIS_POR_SITIO[siteId] ?? "CO";
}

// El título completo suele ser demasiado específico para el buscador de
// Mercado Libre: se usan las primeras 8 palabras (la persona lo puede
// editar antes de buscar).
export function terminoDesdeTitulo(titulo: string | null): string {
  if (!titulo) return "";
  return titulo
    .replace(/[^\p{L}\p{N}\s.,-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .slice(0, 80);
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function texto(valor: unknown, maximo = 300): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, maximo) : null;
}

function fechaIso(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// La ficha a veces dice "Vendido por TIENDA": solo se guarda el nombre.
function nombreTienda(valor: unknown): string | null {
  const t = texto(valor, 140);
  if (!t) return null;
  const limpio = t.replace(/^\s*(vendido|vendida)\s+por\s+/i, "").trim();
  return limpio || null;
}

function booleano(valor: unknown): boolean | null {
  return typeof valor === "boolean" ? valor : null;
}

export function esFotoMlValida(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "mlstatic.com" || u.hostname.endsWith(".mlstatic.com"));
  } catch {
    return false;
  }
}

function competidor(crudo: unknown): CompetidorExtension | null {
  if (!crudo || typeof crudo !== "object") return null;
  const c = crudo as Record<string, unknown>;
  if (typeof c.link !== "string" || !PATRON_LINK_ML.test(c.link)) return null;
  const calificacion = numero(c.calificacion);
  return {
    itemId: typeof c.itemId === "string" && PATRON_ITEM_ID.test(c.itemId) ? c.itemId : null,
    link: c.link.slice(0, 500),
    titulo: texto(c.titulo),
    foto: esFotoMlValida(c.foto) ? c.foto : null,
    vendedor: nombreTienda(c.vendedor),
    precio: numero(c.precio),
    precioAnterior: numero(c.precioAnterior),
    descuentoPorcentaje: numero(c.descuentoPorcentaje),
    vendidos: numero(c.vendidos),
    vendidosExacto: booleano(c.vendidosExacto),
    calificacion: calificacion !== null && calificacion <= 5 ? calificacion : null,
    numeroOpiniones: numero(c.numeroOpiniones),
    esCatalogo: booleano(c.esCatalogo),
    full: booleano(c.esFull),
    envioGratis: booleano(c.envioGratis),
    inventario: numero(c.inventario),
    inventarioAproximado: c.inventarioAproximado === true,
    fotos: numero(c.fotos),
    descripcion: booleano(c.descripcion),
    vendidosEstimados: numero(c.vendidosEstimados),
    antiguedadDias: numero(c.antiguedadDias),
    ventasMes: numero(c.ventasMes),
    facturacionMes: numero(c.facturacionMes),
    leidoDeFicha: c.leidoDeFicha === true,
    manual: c.manual === true,
    actualizadoTs: fechaIso(c.actualizadoTs),
  };
}

// Lee un mensaje de la extensión ("competidores-leidos" /
// "competidores-error") ya filtrado por origen en el componente.
// null = no es un mensaje de esto o no es de esta publicación.
export function leerMensajeCompetidores(datos: unknown, itemIdEsperado: string): MensajeCompetidores | null {
  if (!datos || typeof datos !== "object") return null;
  const d = datos as Record<string, unknown>;
  if (d.fuente !== "zilonix-extension" || !d.payload || typeof d.payload !== "object") return null;
  const payload = d.payload as Record<string, unknown>;
  if (payload.excluirItemId !== itemIdEsperado) return null;
  if (d.tipo === "competidores-error") {
    return { tipo: "error", itemId: itemIdEsperado, razon: typeof payload.razon === "string" ? payload.razon : "desconocida" };
  }
  if (d.tipo !== "competidores-leidos") return null;
  const lista = Array.isArray(payload.competidores) ? payload.competidores : [];
  const competidores = lista
    .slice(0, MAXIMO_COMPETIDORES_EXTENSION)
    .map(competidor)
    .filter((c): c is CompetidorExtension => c !== null);
  return {
    tipo: "ok",
    itemId: itemIdEsperado,
    termino: texto(payload.termino, 120) ?? "",
    modo: payload.modo === "links" ? "links" : "busqueda",
    candidatos: numero(payload.candidatos) ?? competidores.length,
    competidores,
  };
}

// Revalida con el mismo lector que usa la página con el mensaje de la extensión.
// La lista puede quedar vacía (la persona quitó todos) y el término puede
// faltar (solo se agregaron links): en ese caso se guarda "(por link)".
export const TERMINO_POR_LINK = "(por link)";
export function validarCompetidores(entrada: { itemId: string; termino: unknown; candidatos: unknown; competidores: unknown }): { termino: string; candidatos: number; competidores: CompetidorExtension[] } | null {
  if (!Array.isArray(entrada.competidores)) return null;
  const m = leerMensajeCompetidores(
    { fuente: "zilonix-extension", tipo: "competidores-leidos", payload: { excluirItemId: entrada.itemId, termino: entrada.termino, candidatos: entrada.candidatos, competidores: entrada.competidores } },
    entrada.itemId
  );
  if (!m || m.tipo !== "ok") return null;
  // Un elemento descartado por inválido no se guarda en silencio como
  // "vacío": si TODO lo recibido era inválido, es un error.
  if (entrada.competidores.length > 0 && m.competidores.length === 0) return null;
  return { termino: m.termino || TERMINO_POR_LINK, candidatos: m.candidatos, competidores: m.competidores };
}

const RAZONES: Record<string, string> = {
  captcha: "Mercado Libre pidió verificar que eres una persona. Resuélvelo en esa pestaña y vuelve a buscar.",
  sin_resultados: "La búsqueda no trajo publicaciones. Prueba con menos palabras (marca y modelo, por ejemplo).",
  no_se_pudo_abrir: "Chrome no dejó abrir la pestaña de búsqueda. Intenta de nuevo.",
  cerrada: "Se cerró la pestaña de búsqueda antes de terminar.",
};

export function textoRazonCompetidores(razon: string): string {
  return RAZONES[razon] ?? "No se pudo completar la búsqueda. Intenta de nuevo.";
}

export type PropiaComparable = { itemId: string; precio: number | null; envioGratis: boolean | null; full: boolean | null };

// Mismas alertas que la comparación de catálogo (precio, envío gratis,
// Full, fotos). Cuotas, video y descripción propia no se comparan acá:
// la ficha de otro vendedor no muestra el tipo, y lo propio no viene en
// la lista.
export function alertasCompetidoresExtension(propia: PropiaComparable, competidores: CompetidorExtension[]): string[] {
  const fila = (f: { itemId: string; precio: number | null; envioGratis: boolean | null; full: boolean | null; fotos: number | null }, esPropia: boolean): FilaComparacion => ({
    itemId: f.itemId,
    propia: esPropia,
    titulo: null,
    foto: null,
    precio: f.precio,
    precioOriginal: null,
    tipoPublicacion: null,
    envioGratis: f.envioGratis,
    full: f.full,
    fotos: f.fotos,
    video: null,
    descripcion: null,
    reputacion: null,
  });
  return alertasComparacion(
    fila({ ...propia, fotos: null }, true),
    competidores.map((c) => fila({ itemId: c.itemId ?? c.link, precio: c.precio, envioGratis: c.envioGratis, full: c.full, fotos: c.fotos }, false))
  );
}

// "45 días", "8 meses", "2 años". null si no hay dato.
export function rotuloAntiguedad(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias < 60) return `${Math.round(dias)} ${Math.round(dias) === 1 ? "día" : "días"}`;
  if (dias < 730) return `${Math.round(dias / 30)} meses`;
  return `${Math.round(dias / 365)} años`;
}


// ── Parecido con la publicación propia ──────────────────────────────
// Una búsqueda como "luces led" trae diseños distintos. Sin comparar
// fotos (no se hace acá), lo más fiable es cuántas palabras clave del
// título propio aparecen en el título del otro.

const PALABRAS_SIN_PESO = new Set([
  "para", "con", "sin", "del", "los", "las", "una", "uno", "unos", "unas", "por", "que", "como", "mas", "muy", "the", "and", "set", "kit", "pack", "nuevo", "nueva", "original", "envio", "gratis", "full", "oferta",
]);

export function palabrasClave(titulo: string | null): string[] {
  if (!titulo) return [];
  const limpias = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !PALABRAS_SIN_PESO.has(p));
  return Array.from(new Set(limpias));
}

// 0 a 1; null si no hay título propio o del otro con qué comparar.
export function parecidoTitulos(tituloPropio: string | null, tituloOtro: string | null): number | null {
  const propias = palabrasClave(tituloPropio);
  if (propias.length === 0 || !tituloOtro) return null;
  const otras = new Set(palabrasClave(tituloOtro));
  const comunes = propias.filter((p) => otras.has(p)).length;
  return comunes / propias.length;
}

export type NivelParecido = "alto" | "medio" | "bajo";

export function nivelParecido(parecido: number | null): NivelParecido | null {
  if (parecido === null) return null;
  return parecido >= 0.7 ? "alto" : parecido >= 0.4 ? "medio" : "bajo";
}

export const ROTULO_PARECIDO: Record<NivelParecido, string> = {
  alto: "Muy parecido",
  medio: "Parecido",
  bajo: "Poco parecido: revisa si es el mismo producto",
};

// ── Guardar, fusionar y quitar ──────────────────────────────────────

export function claveCompetidor(c: Pick<CompetidorExtension, "itemId" | "link">): string {
  return c.itemId ?? c.link;
}

function mismoCompetidor(a: CompetidorExtension, b: CompetidorExtension): boolean {
  return (a.itemId !== null && a.itemId === b.itemId) || a.link === b.link;
}

export type ResultadoFusion = { lista: CompetidorExtension[]; leidos: number; noLeidos: number };

// Une lo que acaba de leer la extensión con lo ya guardado.
// - "busqueda" (Buscar 10 competidores): reemplaza lo que vino de una
//   búsqueda anterior, pero conserva los que la persona agregó por link.
// - "links" (Agregar por link / Actualizar): cada ficha leída reemplaza
//   al mismo competidor (o se agrega como manual si es nuevo). Una ficha
//   que no se pudo leer nunca pisa datos buenos ya guardados, y un link
//   nuevo que no se pudo leer no se agrega.
export function fusionarCompetidores(guardados: CompetidorExtension[], nuevos: CompetidorExtension[], modo: "busqueda" | "links", ahoraIso: string): ResultadoFusion {
  const sello = (c: CompetidorExtension, manual: boolean): CompetidorExtension => ({ ...c, manual, actualizadoTs: c.leidoDeFicha ? ahoraIso : c.actualizadoTs });
  let lista: CompetidorExtension[];
  let leidos = 0;
  let noLeidos = 0;

  if (modo === "busqueda") {
    const manuales = guardados.filter((g) => g.manual);
    lista = [...manuales];
    for (const n of nuevos) {
      n.leidoDeFicha ? leidos++ : noLeidos++;
      const i = lista.findIndex((g) => mismoCompetidor(g, n));
      if (i >= 0) {
        if (n.leidoDeFicha) lista[i] = sello(n, true);
      } else {
        lista.push(sello(n, false));
      }
    }
  } else {
    lista = [...guardados];
    for (const n of nuevos) {
      const i = lista.findIndex((g) => mismoCompetidor(g, n));
      if (!n.leidoDeFicha) {
        noLeidos++;
        continue;
      }
      leidos++;
      if (i >= 0) lista[i] = sello(n, lista[i].manual);
      else lista.push(sello(n, true));
    }
  }
  return { lista: lista.slice(0, MAXIMO_COMPETIDORES_EXTENSION), leidos, noLeidos };
}

export function quitarCompetidor(lista: CompetidorExtension[], clave: string): CompetidorExtension[] {
  return lista.filter((c) => claveCompetidor(c) !== clave);
}

// Link que la persona pega: solo Mercado Libre (mismo patrón anclado
// que el resto), https.
export function esLinkCompetidorValido(link: string): boolean {
  const l = link.trim();
  return PATRON_LINK_ML.test(l) || /^https:\/\/meli\.la\//i.test(l);
}

// Foto en tamaño grande ("-O" es el original en Mercado Libre) para
// ampliarla; si no hay un sufijo conocido, la misma.
export function fotoGrande(url: string): string {
  return esFotoMlValida(url) ? url.replace(/-[A-Z](\.(?:webp|jpg|jpeg|png))(\?.*)?$/i, "-O$1$2") : url;
}

// Cuánto esperar a la extensión: listado + una ficha por link.
export function esperaMaximaMs(fichas: number): number {
  return 30_000 + Math.max(1, fichas) * 17_000;
}
