// ADENDO UX de Publicar — lógica pura del formulario de "Publicar
// producto nuevo" (sin DOM, sin fetch) para poder probarla con datos
// simples, mismo criterio que lib/ml/publicar-reglas.ts. Las funciones
// de serialización arman EXACTAMENTE el mismo formato de texto que
// actions.ts ya sabe leer (ID=valor por línea, siteId::título=
// categoryId por línea) — para que la UI dinámica (SelectorCategoria,
// CaracteristicasDinamicas, EditorVariantes) no necesite CAMBIAR el
// parser del servidor, solo llenarlo mejor.
//
// Parte 2 (página única, estructura de Zilonix OS) suma 4 helpers más,
// mismo criterio (puros, sin DOM/fetch/DB): resumenEstadoProducto
// (✅/⚠️/❌ del historial), cuentasFallidas + construirEstadoInicial
// (Cargar/Reintentar y Duplicar — reconstruyen el estado del
// formulario desde una fila ya guardada de productos_ml) y moverFoto
// (reordenar la galería con drag & drop).
import { linkPublicacion } from "@/lib/ml/cliente";
import type { DatosPorCuenta, ResultadoPublicacionCuenta, VariantesProducto } from "@/lib/ml/publicar-tipos";

export type DimensionesTexto = { peso: string; largo: string; ancho: string; alto: string };

// Bug real evitado (igual que Zilonix OS actual): alguien pone "1" en
// las 4 medidas sin medir de verdad, para pasar la validación de
// "obligatorias" sin pensarlo — Mercado Libre calcula el costo real de
// envío con esto, un relleno falso cobra mal (o rechaza el pedido más
// adelante). Bloquea SOLO cuando las 4 están presentes Y las 4 son
// <=1 — una sola en 1 (ej. "1cm de ancho" de algo chato de verdad)
// nunca dispara esto solo.
export function esRellenoFalsoDimensiones(dim: DimensionesTexto): boolean {
  const valores = [dim.peso, dim.largo, dim.ancho, dim.alto];
  if (valores.some((v) => v.trim() === "")) return false;
  const numeros = valores.map((v) => Number(v));
  if (numeros.some((n) => !Number.isFinite(n))) return false;
  return numeros.every((n) => n <= 1);
}

// Sin ejes, o con algún eje elegido pero todavía sin ningún valor
// elegido: [] (nunca una combinación "fantasma" con ese eje vacío —
// sería una fila sin cómo distinguirla de otra en la tabla).
export function productoCartesiano(valoresPorEje: Record<string, string[]>, ejes: string[]): Record<string, string>[] {
  if (ejes.length === 0 || ejes.some((eje) => (valoresPorEje[eje] ?? []).length === 0)) return [];
  return ejes.reduce<Record<string, string>[]>((acc, eje) => {
    const valoresEje = valoresPorEje[eje] ?? [];
    const siguiente: Record<string, string>[] = [];
    for (const combinacionPrevia of acc) {
      for (const valor of valoresEje) {
        siguiente.push({ ...combinacionPrevia, [eje]: valor });
      }
    }
    return siguiente;
  }, [{}]);
}

// Mismo formato "ID=valor\nID2=valor2" que parsearLineasClaveValor
// (nuevo/actions.ts) ya sabe leer — nunca se cambia el parser, solo se
// llena mejor desde la UI dinámica. Entradas vacías se omiten (igual
// que el parser, que las ignora de todas formas).
export function serializarClaveValor(valores: Record<string, string>): string {
  return Object.entries(valores)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

// Mismo formato "siteId::título=categoryId" que ya lee nuevo/actions.ts
// (categoriasOverride). `siteId` es el site_id real de la cuenta de
// referencia (issue #315, FormularioPublicar.tsx) — nunca se pide a la
// persona que lo escriba a mano.
export function serializarCategoriaOverride(siteId: string, titulo: string, categoryId: string): string {
  if (!titulo.trim() || !categoryId.trim()) return "";
  return `${siteId}::${titulo}=${categoryId}`;
}

export type MaxFotos = number | null;

// Punto 5 del ADENDO — "galería por URL: respetar max_pictures; la
// primera es portada si no hay portada por cuenta". La categoría
// decide el tope real (obtenerLimiteFotos, lib/ml/publicar.ts — 12 de
// respaldo si Mercado Libre no lo confirma); acá solo se usa ese
// número para avisar/recortar en la UI ANTES de publicar, nunca
// después de un rechazo.
export function fotosDentroDelLimite(urls: string[], limite: MaxFotos): string[] {
  if (limite == null) return urls;
  return urls.slice(0, limite);
}

// --- Parte 2 (página única, estructura de Zilonix OS) ---

// Punto 8 del pedido — "✅ ok/total si todas OK, ⚠️ ok/total si
// parcial, ❌ si ninguna". `null` mientras no haya ningún resultado
// todavía (nunca publicado, o publicando en este instante — la UI
// muestra "Publicando…" en ese caso, no un ícono de estado que
// todavía no existe).
export type ResumenEstadoProducto = { ok: number; total: number; icono: "✅" | "⚠️" | "❌" };

export function resumenEstadoProducto(resultado: ResultadoPublicacionCuenta[] | null | undefined): ResumenEstadoProducto | null {
  if (!resultado || resultado.length === 0) return null;
  const total = resultado.length;
  const ok = resultado.filter((r) => r.ok).length;
  const icono: ResumenEstadoProducto["icono"] = ok === total ? "✅" : ok === 0 ? "❌" : "⚠️";
  return { ok, total, icono };
}

// Punto 8 — "Cargar/Reintentar: ... solo en las cuentas que fallaron,
// preseleccionadas". Un resultado puede ser de éxito, de fallo clásico
// o de familia (User Products, lib/ml/publicar-tipos.ts) — las 3
// formas tienen `ok` y `cuentaMlId`, así que alcanza con eso para
// decidir qué cuenta reintentar; nunca hace falta mirar adentro de
// cada forma.
export function cuentasFallidas(resultado: ResultadoPublicacionCuenta[] | null | undefined): string[] {
  if (!resultado) return [];
  return resultado.filter((r) => !r.ok).map((r) => r.cuentaMlId);
}

// Forma mínima de una fila de productos_ml que hace falta para
// reconstruir el formulario — deliberadamente explícita (no el tipo
// completo inferido de Drizzle) para que esta función se pueda probar
// con datos simples, sin tocar Postgres ni importar db/schema.ts.
export type FilaProductoParaCargar = {
  precio: string;
  stock: number;
  condicion: string;
  envioGratis: boolean;
  sku: string | null;
  dimensiones: Partial<DimensionesTexto>;
  imagenes: { url: string }[];
  atributosExtra: Record<string, string>;
  categoriasOverride: Record<string, string>;
  variantes: VariantesProducto | null;
  porCuenta: Record<string, DatosPorCuenta>;
  cuentasSeleccionadas: string[];
  resultado: ResultadoPublicacionCuenta[] | null;
  modoPrueba: boolean;
};

export type DatosCuentaTexto = { titulo: string; descripcion: string; portadaUrl: string };
export type CombinacionVarianteTexto = { valores: Record<string, string>; sku: string; stock: string; precio: string };
export type VariantesTexto = { ejes: string[]; ejeFoto: string | null; combinaciones: CombinacionVarianteTexto[] };

export type EstadoInicialFormulario = {
  cuentasIncluidas: string[];
  datosPorCuenta: Record<string, DatosCuentaTexto>;
  precio: string;
  stock: string;
  condicion: "new" | "used";
  envioGratis: boolean;
  sku: string;
  dimensiones: DimensionesTexto;
  imagenes: string[];
  atributosExtra: Record<string, string>;
  // Mapa crudo "siteId::título" -> categoryId, tal cual sale de la
  // fila — FormularioPublicar decide SOLO, una vez que sabe cuál es la
  // cuenta/título de referencia (recién con los datos ya cargados),
  // si hay una entrada que matchee para auto-detectar sin que la
  // persona tenga que tocar "Detectar" de nuevo.
  categoriasOverride: Record<string, string>;
  variantes: VariantesTexto | null;
  portadasPorVariante: Record<string, string>;
  modoPrueba: boolean;
};

// Punto 8 — "Cargar/Reintentar: carga ese producto en el formulario de
// arriba... (solo en las cuentas que fallaron, preseleccionadas)" /
// "Duplicar: carga los datos como producto nuevo (cuentas
// desmarcadas)". Mismo transformador para los dos botones — la única
// diferencia real es CUÁLES cuentas quedan marcadas al cargar; todo lo
// demás (precio, dimensiones, atributos, variantes...) se copia igual
// en los dos casos, a propósito (duplicar es "lo mismo, para otra
// tanda de cuentas", nunca un producto distinto).
export function construirEstadoInicial(producto: FilaProductoParaCargar, modo: "reintentar" | "duplicar"): EstadoInicialFormulario {
  const datosPorCuenta: Record<string, DatosCuentaTexto> = {};
  let portadasPorVariante: Record<string, string> = {};
  for (const [cuentaId, datos] of Object.entries(producto.porCuenta ?? {})) {
    datosPorCuenta[cuentaId] = { titulo: datos.titulo ?? "", descripcion: datos.descripcion ?? "", portadaUrl: datos.portadaUrl ?? "" };
    // Comparte un solo mapeo entre cuentas (FormularioPublicar.tsx lo
    // escribe igual en todas, ver ADENDO punto 4) — con la primera
    // cuenta que lo tenga alcanza.
    if (datos.portadasPorVariante && Object.keys(datos.portadasPorVariante).length) portadasPorVariante = datos.portadasPorVariante;
  }

  let cuentasIncluidas: string[] = [];
  if (modo === "reintentar") {
    const fallidas = cuentasFallidas(producto.resultado);
    cuentasIncluidas = fallidas.length ? fallidas : (producto.cuentasSeleccionadas ?? []);
  }
  // modo "duplicar": cuentasIncluidas queda [] (desmarcadas), a propósito.

  const dim = producto.dimensiones ?? {};
  const variantes: VariantesTexto | null =
    producto.variantes && producto.variantes.combinaciones.length > 0
      ? {
          ejes: producto.variantes.ejes,
          ejeFoto: producto.variantes.ejeFoto,
          combinaciones: producto.variantes.combinaciones.map((c) => ({
            valores: c.valores,
            sku: c.sku ?? "",
            stock: c.stock != null ? String(c.stock) : "",
            precio: c.precio != null ? String(c.precio) : "",
          })),
        }
      : null;

  return {
    cuentasIncluidas,
    datosPorCuenta,
    precio: producto.precio,
    stock: String(producto.stock ?? 1),
    condicion: producto.condicion === "used" ? "used" : "new",
    envioGratis: Boolean(producto.envioGratis),
    sku: producto.sku ?? "",
    dimensiones: { peso: dim.peso ?? "", largo: dim.largo ?? "", ancho: dim.ancho ?? "", alto: dim.alto ?? "" },
    imagenes: (producto.imagenes ?? []).map((i) => i.url).filter(Boolean),
    atributosExtra: producto.atributosExtra ?? {},
    categoriasOverride: producto.categoriasOverride ?? {},
    variantes,
    portadasPorVariante,
    modoPrueba: Boolean(producto.modoPrueba),
  };
}

// Punto 8 del pedido — "Fecha (America/Bogota)". `toLocaleString` con
// `timeZone` explícito es independiente de dónde corra el proceso
// (Railway corre en UTC, nunca en la zona de Bogotá) — sin esto, la
// fecha mostrada se corre según dónde esté desplegado, nunca según
// dónde esté la persona que la lee.
export function formatearFechaBogota(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Punto 4 del pedido — "reordenar arrastrando (drag & drop nativo)".
// `desde`/`hasta` fuera de rango (ej. un drop afuera de la lista, o un
// evento repetido) nunca mueve nada ni lanza — se devuelve el mismo
// array tal cual.
export function moverFoto(fotos: string[], desde: number, hasta: number): string[] {
  if (desde === hasta || desde < 0 || desde >= fotos.length || hasta < 0 || hasta >= fotos.length) return fotos;
  const copia = [...fotos];
  const [movida] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movida);
  return copia;
}

// --- Parte 3 (importadores + permalink) ---

// Revisión de seguridad (hallazgo MED) — un solo patrón de hostname
// real de Mercado Libre, compartido por permalinkMlSeguro (abajo) e
// idItemDesdeLinkMl (más abajo en este archivo): cualquier subdominio +
// el país opcional (".co", ".ar", etc.), nunca un dominio que solo
// CONTIENE "mercadolibre.com" en otra parte de la URL (ej.
// "mercadolibre.com.ataque.com" no matchea — el "$" ancla el final).
const PATRON_HOST_MERCADOLIBRE = /(^|\.)mercadolibre\.com(\.[a-z]{2})?$/i;

// Revisión de seguridad (hallazgo MED) — producto.resultado ya viene
// de Mercado Libre (publicar.ts, lib/ml/cliente.ts), pero
// enlacesPermalink arma un <a href> real para HistorialPublicaciones.tsx
// — nunca se confía en que ese campo siga siendo lo que ML mandó
// originalmente (una fila vieja, un bug futuro de publicar.ts, datos
// corruptos): se exige un hostname real de Mercado Libre antes de
// dejarlo pasar a un link clickeable. Un "javascript:"/"data:" o un
// dominio ajeno nunca llega a <a href>.
//
// Feedback real de Mateo probando en staging (publicó 1/1 OK y el
// historial no mostraba ningún link) — causa confirmada contra
// lib/ml/publicar.ts: `permalink` se guarda tal cual lo devuelve
// `POST /items` (`data.permalink`, líneas ~444/679), y esa respuesta de
// creación de Mercado Libre a veces trae el link en `http://` (el
// mismo ítem, consultado después por `GET /items/{id}`, ya lo da en
// `https://` — comportamiento real y conocido de esa API, no un bug de
// este repo). El chequeo de seguridad de la revisión anterior exigía
// `https:` a secas y por eso descartaba en silencio un link real. Acá
// se sigue exigiendo el HOST real de Mercado Libre (nunca se afloja
// eso), pero si el protocolo es `http:` y el host SÍ es de Mercado
// Libre, se sube a `https:` de forma determinística — nunca para un
// host ajeno, que ya se descartó arriba de todas formas.
export function permalinkMlSeguro(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!PATRON_HOST_MERCADOLIBRE.test(parsed.hostname)) return null;
  return parsed.protocol === "http:" ? url.replace(/^http:/i, "https:") : url;
}

// Mismo feedback de Mateo — a veces `producto.resultado` ni siquiera
// trae `permalink` (confirmado como posible en el tipo:
// `ResultadoFamiliaItem.permalink` es opcional; y una fila vieja previa
// a que `publicar.ts` empezara a guardarlo tampoco lo tendría). Con el
// `itemId` real ya confirmado por Mercado Libre (ese sí siempre está en
// un resultado `ok:true`) se arma el link oficial sin llamar a la API
// — mismo formato exacto que ya usa `linkPublicacion` (lib/ml/cliente.ts,
// confirmado contra producción de zilonix-os-web: Colombia, único site
// en alcance de esta fase). `permalinkMlSeguro` sigue siendo el único
// camino para un permalink que SÍ vino de Mercado Libre — este armado
// manual es solo el respaldo cuando no hay nada que validar.
function permalinkOArmado(permalink: string | undefined, itemId: string | undefined): string | null {
  if (permalink) {
    const seguro = permalinkMlSeguro(permalink);
    if (seguro) return seguro;
  }
  return itemId ? linkPublicacion(itemId) : null;
}

// Punto B del pedido — "cuando una cuenta publicó OK, el nombre de la
// cuenta o un link debe abrir ese permalink. No inventes columna; lee
// producto.resultado." Una sola función, discrimina por forma (ver
// lib/ml/publicar-tipos.ts): la familia (User Products) puede traer
// VARIOS permalinks (uno por ítem/variante) bajo la misma cuenta — se
// listan todos, nunca solo el primero (publicar.ts ya los guarda todos,
// perderlos acá sería descartar un dato que ya existe). El caso
// clásico de éxito trae uno solo. Un fallo (ok:false) nunca tiene
// permalink — se omite, nunca un link roto.
export type EnlacePermalink = { cuentaMlId: string; etiqueta: string; permalink: string };

export function enlacesPermalink(
  resultado: ResultadoPublicacionCuenta[] | null | undefined,
  cuentas: { id: string; nickname: string }[]
): EnlacePermalink[] {
  if (!resultado) return [];
  const nicknamePorCuenta = new Map(cuentas.map((c) => [c.id, c.nickname]));
  const enlaces: EnlacePermalink[] = [];
  for (const r of resultado) {
    const nombreCuenta = nicknamePorCuenta.get(r.cuentaMlId) ?? r.cuentaMlId;
    if ("familia" in r) {
      for (const item of r.familia.items) {
        if (!item.ok) continue;
        const link = permalinkOArmado(item.permalink, item.itemId);
        if (!link) continue;
        const sufijo = item.sku || Object.values(item.valores).join(" / ");
        enlaces.push({ cuentaMlId: r.cuentaMlId, etiqueta: sufijo ? `${nombreCuenta} (${sufijo})` : nombreCuenta, permalink: link });
      }
    } else if (r.ok) {
      const link = permalinkOArmado(r.permalink, r.itemId);
      if (link) enlaces.push({ cuentaMlId: r.cuentaMlId, etiqueta: nombreCuenta, permalink: link });
    }
  }
  return enlaces;
}

// Punto A del pedido — forma común de "lo que se trajo de afuera" para
// precargar el formulario, sin importar si vino de un SKU propio, de un
// link, o del bookmarklet (las 3 vías del punto A llegan a esto mismo,
// nunca cada una con su propio camino de hidratación). Todo texto
// (nunca número) porque así lo espera EstadoInicialFormulario — mismo
// criterio que el resto de este archivo.
export type ItemImportado = {
  titulo: string;
  descripcion: string;
  precio: string;
  stock: string;
  sku: string;
  imagenes: string[];
  dimensiones: Partial<DimensionesTexto>;
};

// Mismo criterio que estadoInicialDesdePrefill (PaginaPublicar.tsx,
// prefill de Investigación): título/descripción/portada se copian
// IGUAL a todas las cuentas conectadas (quien importa todavía no eligió
// a mano para cuál cuenta es cada campo) — `cuentasIncluidas` queda
// vacío a propósito, igual que "Duplicar". Recibe los ids de cuenta en
// vez de Cuenta[] completo para poder probarse sin React.
export function construirEstadoInicialDesdeImportacion(cuentaIds: string[], item: ItemImportado): EstadoInicialFormulario {
  const portada = item.imagenes[0] ?? "";
  const datosPorCuenta: Record<string, DatosCuentaTexto> = {};
  for (const id of cuentaIds) datosPorCuenta[id] = { titulo: item.titulo, descripcion: item.descripcion, portadaUrl: portada };
  return {
    ...estadoInicialVacioBase(),
    datosPorCuenta,
    precio: item.precio,
    stock: item.stock || "1",
    sku: item.sku,
    dimensiones: { peso: item.dimensiones.peso ?? "", largo: item.dimensiones.largo ?? "", ancho: item.dimensiones.ancho ?? "", alto: item.dimensiones.alto ?? "" },
    imagenes: item.imagenes,
  };
}

// Base vacía puramente local (sin React) — PaginaPublicar.tsx tiene la
// suya propia (estadoInicialVacio) con los mismos valores; se duplica a
// propósito en vez de importarla desde un componente "use client" (este
// archivo tiene que seguir siendo importable sin DOM/React, igual que
// el resto de formulario-logica.ts).
function estadoInicialVacioBase(): EstadoInicialFormulario {
  return {
    cuentasIncluidas: [],
    datosPorCuenta: {},
    precio: "",
    stock: "1",
    condicion: "new",
    envioGratis: false,
    sku: "",
    dimensiones: { peso: "", largo: "", ancho: "", alto: "" },
    imagenes: [],
    atributosExtra: {},
    categoriasOverride: {},
    variantes: null,
    portadasPorVariante: {},
    modoPrueba: true,
  };
}

// Punto A.2 del pedido — "parsear robustamente el id del ítem: paths
// /MCO-…, /p/MCO…, query params, etc.". Nunca scrapea la página (eso
// está prohibido, ver CLAUDE.md): solo interpreta el TEXTO del link
// pegado para sacar un id con el que después sí se llama a la API
// oficial (obtenerItemMl/leerItemCompletoMl, con token). Devuelve
// siempre "MCO" + dígitos (sin el guion que Mercado Libre pone en la
// URL humana) — el mismo formato que PATRON_ID_PRODUCTO_O_ITEM
// (lib/ml/cliente.ts) exige antes de llamar a la API.
export function idItemDesdeLinkMl(urlCruda: string): string | null {
  const texto = urlCruda.trim();
  if (!texto) return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (!PATRON_HOST_MERCADOLIBRE.test(url.hostname)) return null;

  const candidatos: string[] = [];
  for (const clave of ["wid", "item_id", "itemId"]) {
    const valor = url.searchParams.get(clave);
    if (valor) candidatos.push(valor);
  }
  const porProducto = url.pathname.match(/\/p\/(MCO\d+)/i);
  if (porProducto) candidatos.push(porProducto[1]);
  const porPublicacion = url.pathname.match(/\/(MCO-?\d+)(?:[/?#-]|$)/i);
  if (porPublicacion) candidatos.push(porPublicacion[1]);

  for (const candidato of candidatos) {
    const normalizado = candidato.toUpperCase().replace(/-/g, "");
    if (/^MCO\d+$/.test(normalizado)) return normalizado;
  }
  return null;
}

// Punto D del pedido — "Importar a Publicar" desde la extensión: el
// botón del content script (extension/content.js) lee título/
// descripción/precio/galería de la publicación de Mercado Libre
// abierta y lo manda por el relevo content->background->marcador/
// postMessage (mismo mecanismo ya usado para "Completar vendidos" —
// ver extension/marcador-zilonix.js). PaginaPublicar.tsx escucha ese
// mensaje, pero NUNCA confía ciegamente en lo que llega por
// postMessage (ver el comentario real de marcador-zilonix.js: "el
// panel vuelve a validar todo el payload igual") — esta función es esa
// validación, pura y con sus propias pruebas. `imagenes` se filtra a
// solo http(s) reales (nunca javascript:/data: disfrazado) — mismo
// criterio que ZilonixSeguridad.linkSeguro del lado de la extensión,
// reimplementado acá sin DOM/fetch porque este archivo no puede
// importar nada de lib/ (helper puro, sin ciclos).
// Issue #44 (revisión — hallazgo real al preparar "Importar por link")
// — antes esta función solo exigía `https://` a secas para una foto —
// CUALQUIER host https pasaba. Se endurece para exigir el dominio REAL
// de imágenes de Mercado Libre (mlstatic.com, mismo hostname anclado
// que ya usa esUrlFotoMlValida del lado de la extensión,
// extension/lectores/mercadolibre.js — ese archivo no se puede
// importar acá, DOM/chrome-dependiente, así que se reimplementa el
// mismo chequeo, puro, sin DOM). Nunca un substring suelto
// (`mlstatic.com` en cualquier parte de la URL) — el HOSTNAME real,
// anclado con `(^|\.)mlstatic\.com$`, mismo criterio que
// PATRON_HOST_MERCADOLIBRE más arriba en este archivo.
function esUrlFotoMlSegura(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && /(^|\.)mlstatic\.com$/i.test(parsed.hostname);
}

export function itemImportadoDesdeMensajeExtension(datos: unknown): ItemImportado | null {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return null;
  const d = datos as Record<string, unknown>;
  const titulo = typeof d.titulo === "string" ? d.titulo.slice(0, 60) : "";
  const descripcion = typeof d.descripcion === "string" ? d.descripcion : "";
  const precio = typeof d.precio === "number" && Number.isFinite(d.precio) && d.precio > 0 ? String(d.precio) : "";
  const imagenes = Array.isArray(d.imagenes) ? d.imagenes.filter((u): u is string => typeof u === "string" && esUrlFotoMlSegura(u)) : [];
  if (!titulo && !descripcion && !precio && imagenes.length === 0) return null; // mensaje vacío/con otra forma — nunca se hidrata el formulario con nada
  return { titulo, descripcion, precio, stock: "", sku: "", imagenes, dimensiones: {} };
}

// Punto A.3 del pedido — lee el JSON que copia el bookmarklet portado
// de zilonix-os-web/lib/ml-bookmarklet.js (galeria:[{id,url}], precio
// número o null, dimensiones ya en cm/gramos tal cual las arma ESE
// script en el navegador de la persona — nunca se vuelve a convertir
// acá). Nunca lanza con texto pegado inválido (puede venir con espacios
// de más, o la persona pegó cualquier otra cosa por error) — null, el
// llamador decide el mensaje.
export function parseImportacionBookmarklet(texto: string): ItemImportado | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto.trim());
  } catch {
    return null;
  }
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const d = crudo as Record<string, unknown>;
  const dim = (d.dimensiones && typeof d.dimensiones === "object" ? (d.dimensiones as Record<string, unknown>) : {}) ?? {};
  const galeria = Array.isArray(d.galeria) ? d.galeria : [];
  // Revisión de seguridad (hallazgo MED) — mismas reglas que
  // itemImportadoDesdeMensajeExtension (el mensaje de "Importar a
  // Publicar" de la extensión): el JSON lo pega la PERSONA a mano
  // (copiado por el bookmarklet, corriendo en su propio navegador),
  // pero nunca se confía en que el texto pegado sea de verdad lo que
  // el bookmarklet copió — un "javascript:"/"data:" disfrazado de URL
  // de foto nunca llega a <img src> ni a la portada del formulario.
  const imagenes = galeria
    .map((g) => (g && typeof g === "object" && typeof (g as { url?: unknown }).url === "string" ? (g as { url: string }).url : null))
    .filter((u): u is string => !!u && /^https:\/\//i.test(u));
  const titulo = typeof d.titulo === "string" ? d.titulo : "";
  const descripcion = typeof d.descripcion === "string" ? d.descripcion : "";
  const precio = typeof d.precio === "number" && Number.isFinite(d.precio) ? String(d.precio) : "";
  if (!titulo && !descripcion && !precio && imagenes.length === 0) return null; // nada útil pegado — nunca se hidrata el formulario con nada
  return {
    titulo,
    descripcion,
    precio,
    stock: "",
    sku: "",
    imagenes,
    dimensiones: {
      peso: typeof dim.peso === "string" ? dim.peso : "",
      largo: typeof dim.largo === "string" ? dim.largo : "",
      ancho: typeof dim.ancho === "string" ? dim.ancho : "",
      alto: typeof dim.alto === "string" ? dim.alto : "",
    },
  };
}
