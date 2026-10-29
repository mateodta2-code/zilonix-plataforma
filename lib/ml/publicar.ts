import { and, eq, inArray, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, productosMl, publicaciones } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  actualizarItemMl,
  agregarDescripcionItemMl,
  buscarEnSitioMl,
  crearItemMl,
  domainDiscoveryMl,
  leerAtributosCategoriaMl,
  leerCategoriaMl,
  leerCategoriasRaizMl,
  leerCuentaMl,
  type NodoCategoriaMl,
} from "@/lib/ml/cliente";
import {
  aplicarReglaSaleFormat,
  aplicarRespaldoDimensionesProducto,
  CAMPOS_NUMERICOS,
  canonicalizarValorListaCerrada,
  conUnidadSiHaceFalta,
  decidirAtributoGtin,
  detectarGeneroPorTitulo,
  esErrorDeFamilyName,
  esRechazoDeVariantesPorCategoria,
  esValorNumericoValido,
  exigeGtinPorMarca,
  faltanDimensionesPaquete,
  limitarStock,
  marcaGenerica,
  resolverIdsPaquete,
  truncarTitulo,
  valorAutocompletadoSeguro,
} from "@/lib/ml/publicar-reglas";
import {
  CURRENCY_POR_SITE,
  LISTING_TYPE_POR_DEFECTO,
  type AtributoAsumido,
  type DatosPorCuenta,
  type DefinicionAtributoMl,
  type DimensionesProducto,
  type ImagenProducto,
  type ResultadoFamiliaItem,
  type ResultadoPublicacionCuenta,
  type ResultadoPublicacionFamilia,
  type VariantesProducto,
} from "@/lib/ml/publicar-tipos";

// Tarea 2.11 ("Publicar producto y clip") — orquestación real contra la
// API de Mercado Libre. Cada paso numerado abajo corresponde 1:1 a la
// sección del mismo número en la investigación hecha contra el código
// real ya en producción del Zilonix OS actual
// (zilonix-os-web/lib/mercadolibre-publicar.js). Mateo pidió el 100%
// de las reglas reales, sin recortar alcance — las reglas puras (sin
// red) viven en lib/ml/publicar-reglas.ts, con sus propias pruebas.
//
// Diferencia deliberada de arquitectura frente al sistema actual (no es
// un copy-paste de datos): en vez de una app de Mercado Libre aparte
// ("Zilonix OS"/Promociones) que rota su propio refresh_token en cada
// publicación, se reusa el mismo mecanismo de token ya construido en
// la tarea 2.3 (lib/ml/cuentas.ts, obtenerAccessTokenVigente) — el
// sistema actual tiene HOY tres implementaciones paralelas de este
// mismo publicador (interno, FullyLemon, modo prueba) ya divergentes
// entre sí; acá es una sola función, con la cuenta como parámetro, tal
// como señala el propio reporte de investigación como "la oportunidad
// más grande de esta tarea".

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CategoriaResuelta = { categoryId: string; categoryName: string; domainName: string | null };

// §4 — GET /categories/{id} — sin token, endpoint público. Tarea 2.11,
// punto 2: el fetch directo se movió a lib/ml/cliente.ts
// (leerCategoriaMl) — valida categoryId con el mismo patrón de
// siempre antes de armar la URL.
export async function leerCategoriaPorId(categoryId: string): Promise<CategoriaResuelta> {
  const cat = await leerCategoriaMl(categoryId);
  return { categoryId: cat.categoryId, categoryName: cat.categoryName, domainName: null };
}

// §4, respaldo — cuando domain_discovery no encuentra nada (confirmado
// en vivo, 16/9: títulos que empiezan por número, ej. "5 Titanium
// potencializador sexual para hombre", antes bloqueaban la publicación
// por completo). Se mira a qué categoría pertenecen los productos que
// YA existen en Mercado Libre para ese mismo texto y se usa la MODA
// (la más repetida) entre los primeros 10 resultados — nunca se
// inventa una categoría si esto también falla.
export async function resolverCategoriaPorBusqueda(siteId: string, titulo: string, token: string): Promise<CategoriaResuelta | null> {
  const resultados = await buscarEnSitioMl(siteId, titulo, token, 10);
  if (!resultados.length) return null;
  const conteo: Record<string, number> = {};
  resultados.forEach((r) => {
    conteo[r.categoryId] = (conteo[r.categoryId] ?? 0) + 1;
  });
  const [categoriaId] = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
  const cat = await leerCategoriaPorId(categoriaId);
  return { categoryId: cat.categoryId, categoryName: cat.categoryName, domainName: null };
}

// §4 — GET /sites/{siteId}/domain_discovery/search — contrato real
// confirmado contra datos reales (no documentación desactualizada):
// "category_predictor" ya no existe, el reemplazo real es
// "domain_discovery". Reintenta 3 veces con backoff (800*intento ms)
// por un 403 puntual visto en vivo al encadenar muchas cuentas
// seguidas; una respuesta OK pero VACÍA no se reintenta (no serviría
// de nada) — se cae directo al respaldo por búsqueda. Tarea 2.11,
// punto 2: el fetch directo se movió a domainDiscoveryMl
// (lib/ml/cliente.ts) — la lógica de reintento/respaldo se queda acá
// tal cual, solo cambia de dónde sale la respuesta HTTP.
export async function resolverCategoria(siteId: string, titulo: string, token: string): Promise<CategoriaResuelta> {
  let ultimoError = "";
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) await esperar(800 * intento);
    const r = await domainDiscoveryMl(siteId, titulo, token, 1);
    if (r.ok) {
      const primero = r.resultados[0];
      if (primero?.categoryId) {
        return { categoryId: primero.categoryId, categoryName: primero.categoryName, domainName: primero.domainName };
      }
      const catRespaldo = await resolverCategoriaPorBusqueda(siteId, titulo, token);
      if (catRespaldo) return catRespaldo;
      throw new Error(
        `Mercado Libre no encontró categoría para "${titulo}" en ${siteId} — probá acortar el título (ej. quitar números al inicio) o elegí la categoría a mano.`
      );
    }
    ultimoError = `No se pudo predecir la categoría en ${siteId} (HTTP ${r.status}).`;
  }
  throw new Error(ultimoError);
}

// §4, función hermana — búsqueda manual para cuando la detección
// automática por título se equivoca (confirmado en vivo: la misma
// familia de producto cayó en categorías distintas solo por cómo
// estaba redactado el título).
export async function buscarCategorias(siteId: string, texto: string, token: string, limite = 8): Promise<CategoriaResuelta[]> {
  const r = await domainDiscoveryMl(siteId, texto, token, limite);
  if (!r.ok) throw new Error(`No se pudo buscar categorías (HTTP ${r.status}).`);
  return r.resultados.map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, domainName: c.domainName }));
}

// §6 — GET /categories/{id}, max_pictures_per_item. Error real evitado:
// "item.pictures.max" ("Items in category MCO430226 cannot exceeds 12
// pictures.") que rechaza la publicación ENTERA, no solo las fotos de
// más. Nunca falla: 12 de respaldo en los 3 caminos (no-ok, ausente,
// excepción) — el límite estándar más común, y el que reportó este
// mismo error en vivo.
export async function obtenerLimiteFotos(categoryId: string): Promise<number> {
  try {
    const cat = await leerCategoriaMl(categoryId);
    return cat.maxPicturesPerItem || 12;
  } catch {
    return 12;
  }
}

export type AtributosObligatoriosResueltos = {
  atributos: { id: string; value_name: string }[];
  asumidos: AtributoAsumido[];
  emptyGtinReasonDef: DefinicionAtributoMl | null;
  brandDef: DefinicionAtributoMl | null;
  paqueteIds: Record<"peso" | "largo" | "ancho" | "alto", string>;
};

// §5 — la función más densa. GET /categories/{id}/attributes es
// público (sin token). Devuelve los atributos finales a mandar más las
// definiciones crudas que el llamador necesita después (GTIN/BRAND,
// para el árbol de decisión y el reintento de marca).
export async function resolverAtributosObligatorios(
  categoryId: string,
  atributosExtraEntrada: Record<string, string>,
  titulo: string
): Promise<AtributosObligatoriosResueltos> {
  const todos = (await leerAtributosCategoriaMl(categoryId)) as DefinicionAtributoMl[];
  const obligatorios = todos.filter((a) => a.tags?.required);

  const finales: { id: string; value_name: string }[] = [];
  const asumidos: AtributoAsumido[] = [];
  const idsEnviados = new Set<string>();

  // Paso 1 — TODO lo que la persona llenó, obligatorio o no (bug real
  // reportado por Débora: antes solo se recorrían los "obligatorios",
  // perdiendo cualquier característica secundaria llenada a mano).
  for (const [id, valorCrudo] of Object.entries(atributosExtraEntrada)) {
    if (valorCrudo === undefined || valorCrudo === null || valorCrudo === "") continue;
    let texto = String(valorCrudo);
    if (CAMPOS_NUMERICOS.test(id) && !esValorNumericoValido(texto)) continue; // ej. "N/A" en un campo numérico — se omite, nunca se manda basura
    const defAtributo = todos.find((a) => a.id === id);
    if (defAtributo) texto = canonicalizarValorListaCerrada(defAtributo, texto); // puede lanzar — lista cerrada real
    texto = conUnidadSiHaceFalta(id, texto);
    finales.push({ id, value_name: texto });
    idsEnviados.add(id);
  }

  // Paso 2 — autocompletar obligatorios que nadie llenó ("No aplica" o
  // la opción genérica/por-título más segura — nunca values[0] a ciegas).
  for (const a of obligatorios) {
    if (idsEnviados.has(a.id)) continue;
    let valor: string;
    if (a.values?.length) {
      valor = valorAutocompletadoSeguro(a.id, titulo, a.values).name;
    } else {
      valor = "No aplica";
    }
    asumidos.push({ id: a.id, nombre: a.name, valorAsumido: valor });
    finales.push({ id: a.id, value_name: valor });
    idsEnviados.add(a.id);
  }

  // GENDER, tercer intento real (Melissa, "Brazaletes para Mujer...",
  // categoría Pulseras): en esa categoría GENDER es SECUNDARIA/opcional,
  // así que el paso 2 (solo obligatorios) nunca lo tocaba — pero
  // Mercado Libre valida el título contra el género aunque el atributo
  // sea opcional. Mismo criterio que seller_package_*: si la categoría
  // define GENDER y nadie lo llenó, se resuelve igual por el título.
  if (!idsEnviados.has("GENDER")) {
    const generoDef = todos.find((a) => a.id === "GENDER");
    if (generoDef?.values?.length) {
      const valor = detectarGeneroPorTitulo(titulo, generoDef.values);
      if (valor) {
        asumidos.push({ id: "GENDER", nombre: generoDef.name, valorAsumido: valor.name });
        finales.push({ id: "GENDER", value_name: valor.name });
        idsEnviados.add("GENDER");
      }
    }
  }

  const emptyGtinReasonDef = todos.find((a) => a.id === "EMPTY_GTIN_REASON") ?? null;
  const brandDef = todos.find((a) => a.id === "BRAND") ?? null;
  const idsRealesCategoria = new Set(todos.map((a) => a.id));
  const paqueteIds = resolverIdsPaquete(idsRealesCategoria);

  return { atributos: finales, asumidos, emptyGtinReasonDef, brandDef, paqueteIds };
}

// IDs que Zilonix ya llena solo (dimensiones, SKU, garantía) — no hace
// falta mostrarlos de nuevo en el formulario de características.
const YA_CUBIERTOS = new Set([
  "SELLER_SKU",
  "EMPTY_GTIN_REASON",
  "seller_package_weight",
  "seller_package_length",
  "seller_package_width",
  "seller_package_height",
  "SELLER_PACKAGE_WEIGHT",
  "SELLER_PACKAGE_LENGTH",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_HEIGHT",
]);

export type CaracteristicaCategoria = {
  id: string;
  nombre: string;
  obligatorio: boolean;
  valores: string[];
  valueType: string | null;
  permiteVariante: boolean; // tags.allow_variations — pedido de Débora
  definePic: boolean; // tags.defines_picture — pedido de Débora, 16/9
};

// ADENDO UX de Publicar, punto 2 — "árbol de categorías: UI + ruta que
// liste raíces/hijos" (mismo patrón que app/api/ml/categorias-arbol
// del Zilonix OS actual, portado acá). Solo para cuando ni la
// predicción automática (resolverCategoria) ni la búsqueda de texto
// (buscarCategorias) dan con la categoría correcta — navegación manual
// nivel por nivel. Sin categoryId, trae la raíz real del sitio
// (leerCategoriasRaizMl, nuevo); con categoryId, el siguiente nivel
// (children de leerCategoriaMl) + el breadcrumb real (pathFromRoot).
// `esHoja` nunca se adivina por otro campo — children vacío es la
// señal real que da Mercado Libre.
export type NodoArbolCategorias = {
  categoryId: string;
  categoryName: string;
  esRaiz: boolean;
  esHoja: boolean;
  pathFromRoot: NodoCategoriaMl[];
  children: NodoCategoriaMl[];
};

export async function leerArbolCategorias(siteId: string, token: string, categoryId?: string): Promise<NodoArbolCategorias> {
  if (!categoryId) {
    const raices = await leerCategoriasRaizMl(siteId, token);
    return { categoryId: "", categoryName: "", esRaiz: true, esHoja: false, pathFromRoot: [], children: raices };
  }
  const cat = await leerCategoriaMl(categoryId);
  return {
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    esRaiz: false,
    esHoja: cat.childrenCategories.length === 0,
    pathFromRoot: cat.pathFromRoot,
    children: cat.childrenCategories,
  };
}

// §7 — función de PREPARACIÓN del formulario (no publica nada). Expone
// qué características tiene la categoría detectada para que la persona
// pueda llenarlas antes de publicar, separadas en principales
// (obligatorias, o que definen variante/imagen) y secundarias.
export async function obtenerCaracteristicasCategoria(
  siteId: string,
  titulo: string,
  token: string,
  categoriaIdManual?: string
): Promise<{ categoryId: string; categoryName: string; siteId: string; principales: CaracteristicaCategoria[]; secundarias: CaracteristicaCategoria[] }> {
  const cat = categoriaIdManual ? await leerCategoriaPorId(categoriaIdManual) : await resolverCategoria(siteId, titulo, token);
  const todos = (await leerAtributosCategoriaMl(cat.categoryId)) as DefinicionAtributoMl[];
  const relevantes = todos.filter((a) => !YA_CUBIERTOS.has(a.id) && !a.tags?.hidden && !a.tags?.read_only);
  const esPrincipal = (a: DefinicionAtributoMl) => Boolean(a.tags?.required || a.tags?.catalog_required || a.tags?.allow_variations || a.tags?.defines_picture);
  const armar = (a: DefinicionAtributoMl): CaracteristicaCategoria => ({
    id: a.id,
    nombre: a.name,
    obligatorio: Boolean(a.tags?.required || a.tags?.catalog_required),
    valores: (a.values ?? []).slice(0, 60).map((v) => v.name),
    valueType: a.value_type ?? null,
    permiteVariante: Boolean(a.tags?.allow_variations),
    definePic: Boolean(a.tags?.defines_picture),
  });
  const principales = relevantes.filter(esPrincipal).map(armar).sort((a, b) => (b.obligatorio ? 1 : 0) - (a.obligatorio ? 1 : 0));
  const secundarias = relevantes.filter((a) => !esPrincipal(a)).map(armar);
  return { categoryId: cat.categoryId, categoryName: cat.categoryName, siteId, principales, secundarias };
}

// Forma real de la fila de productos_ml que necesita el publicador —
// deliberadamente explícita (no "SELECT *" como en el sistema actual)
// para que el port sea tipado de punta a punta.
export type ProductoParaPublicar = {
  id: string;
  titulo: string | null;
  condicion: string;
  precio: string;
  stock: number;
  envioGratis: boolean;
  sku: string | null;
  dimensiones: DimensionesProducto;
  imagenes: ImagenProducto[];
  atributosExtra: Record<string, string>;
  categoriasOverride: Record<string, string>;
  variantes: VariantesProducto | null;
  porCuenta: Record<string, DatosPorCuenta>;
  modoPrueba: boolean;
};

type CuentaParaPublicar = { id: string; cuentaIdExterna: string };

type CategoriaCacheEntry = {
  categoryId: string;
  categoryName: string;
  atributos: { id: string; value_name: string }[];
  asumidos: AtributoAsumido[];
  emptyGtinReasonDef: DefinicionAtributoMl | null;
  brandDef: DefinicionAtributoMl | null;
  paqueteIds: Record<"peso" | "largo" | "ancho" | "alto", string>;
};

// §12 — camino "User Products" (ej. Organizadores de Maletas, ropa
// interior): estas categorías NO admiten "variations" clásico — cada
// combinación se publica como su PROPIO ítem independiente, agrupados
// solo porque TODOS comparten el mismo "family_name" EXACTO (doc.
// oficial de Mercado Libre). Nunca se asume éxito en silencio: cada
// ítem se crea y se reporta individualmente.
async function publicarFamiliaUserProducts(
  cuenta: CuentaParaPublicar,
  producto: ProductoParaPublicar,
  token: string,
  siteId: string,
  categoryId: string,
  categoryName: string,
  tituloBase: string,
  descripcion: string,
  portadaUrl: string | null,
  atributosFinal: { id: string; value_name: string }[],
  limiteFotos: number
): Promise<ResultadoPublicacionFamilia> {
  const familyName = truncarTitulo(tituloBase);
  const ejesVariante = producto.variantes?.ejes ?? [];
  const combinaciones = producto.variantes?.combinaciones ?? [];
  const ejeFoto = producto.variantes?.ejeFoto ?? null;
  const porCuenta = producto.porCuenta ?? {};
  const datosCuenta = porCuenta[cuenta.id] ?? Object.values(porCuenta)[0] ?? {};
  const portadasPorVariante = datosCuenta.portadasPorVariante ?? {};

  const items: ResultadoFamiliaItem[] = [];
  for (const c of combinaciones) {
    const atributosCombinacion = [
      ...atributosFinal,
      ...ejesVariante.map((ejeId) => ({ id: ejeId, value_name: c.valores[ejeId] })),
      ...(c.sku ? [{ id: "SELLER_SKU", value_name: c.sku }] : []),
    ];
    const valorEjeFoto = ejeFoto ? c.valores[ejeFoto] : null;
    const portadaCombinacion = (valorEjeFoto && portadasPorVariante[valorEjeFoto]) || portadaUrl;
    const pictures = Array.from(new Set([portadaCombinacion].filter((u): u is string => Boolean(u))))
      .slice(0, limiteFotos)
      .map((url) => ({ source: url }));

    const body: Record<string, unknown> = {
      category_id: categoryId,
      currency_id: CURRENCY_POR_SITE[siteId] ?? "COP",
      buying_mode: "buy_it_now",
      condition: producto.condicion || "new",
      listing_type_id: LISTING_TYPE_POR_DEFECTO,
      pictures,
      attributes: atributosCombinacion,
      sale_terms: [
        { id: "WARRANTY_TYPE", value_name: "Garantía del vendedor" },
        { id: "WARRANTY_TIME", value_name: "30 días" },
      ],
      family_name: familyName,
      price: Number(c.precio) || Number(producto.precio),
      available_quantity: limitarStock(Number(c.stock) || 1),
    };
    // Mejora deliberada sobre el original (hallazgo del reporte de
    // investigación, §12: "producto.envio_gratis NO se aplica en este
    // camino" — un vacío no documentado, nunca una decisión de
    // negocio) — se aplica igual que en el camino clásico.
    if (producto.envioGratis) body.shipping = { free_shipping: true };

    const r = await crearItemMl(token, body);
    if (!r.ok) {
      // r.status === 0 = tiempo agotado o falla de red en escribir() —
      // r.textoCrudo queda vacío (nunca llegó respuesta), y el ítem
      // puede haberse creado del otro lado aunque el POST se haya
      // cortado de este — reintentar a ciegas arriesga duplicarlo.
      const error =
        r.status === 0
          ? "Mercado Libre no respondió a tiempo; revisá en Mercado Libre si la publicación se creó antes de reintentar."
          : r.textoCrudo.slice(0, 2000);
      items.push({ valores: c.valores, sku: c.sku, ok: false, error });
      continue;
    }
    const data = r.data!;
    const itemId = data.id as string;
    if (descripcion) {
      await agregarDescripcionItemMl(itemId, token, descripcion).catch(() => null);
    }
    let estadoFinal = data.status as string;
    if (producto.modoPrueba) {
      const pausaR = await actualizarItemMl(itemId, token, { status: "paused" }).catch(() => null);
      if (pausaR?.ok) estadoFinal = "paused";
    }
    items.push({ valores: c.valores, sku: c.sku, ok: true, itemId, permalink: data.permalink as string, status: estadoFinal });
  }

  const exitosos = items.filter((i) => i.ok);
  return {
    cuentaMlId: cuenta.id,
    ok: exitosos.length > 0,
    categoria: categoryName,
    familia: { familyName, items },
    error: exitosos.length === 0 ? "Ninguna combinación se pudo publicar como familia." : undefined,
  };
}

// §3 — la función central, paso a paso. Cada comentario numerado abajo
// referencia la sección del reporte de investigación con el mismo número.
export async function publicarProductoEnCuenta(
  empresaId: string,
  cuenta: CuentaParaPublicar,
  producto: ProductoParaPublicar,
  categoriasCache: Record<string, CategoriaCacheEntry>
): Promise<ResultadoPublicacionCuenta> {
  // 3.1 — token + site_id en vivo, nunca asumido.
  const token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
  const { siteId } = await leerCuentaMl(cuenta.cuentaIdExterna, token);

  // 3.2 — título/descripción/portada por cuenta, cae al primer registro si falta.
  const porCuenta = producto.porCuenta ?? {};
  const datosCuenta = porCuenta[cuenta.id] ?? Object.values(porCuenta)[0] ?? {};
  const titulo = (datosCuenta.titulo ?? "").trim();
  const descripcion = (datosCuenta.descripcion ?? "").trim();
  const portadaUrl = datosCuenta.portadaUrl ?? null;
  if (!titulo) throw new Error("No hay título configurado para esta cuenta.");

  // 3.3 — atributosExtra + SKU.
  let atributosExtra: Record<string, string> = { ...(producto.atributosExtra ?? {}) };
  if (producto.sku) atributosExtra.SELLER_SKU = producto.sku;

  // 3.4/3.5 — SALE_FORMAT/UNITS_PER_PACK — puede lanzar (Pack sin valor real), a propósito ANTES de llamar a ML.
  atributosExtra = aplicarReglaSaleFormat(atributosExtra);

  // 3.7 — WIDTH/HEIGHT/LENGTH/WEIGHT del producto, con respaldo del paquete.
  const dim = producto.dimensiones ?? {};
  atributosExtra = aplicarRespaldoDimensionesProducto(atributosExtra, dim);

  // 3.6 — SKU directo (los 4 del paquete se agregan después de resolver categoría).
  const atributosDimensiones: { id: string; value_name: string }[] = [];
  if (producto.sku) atributosDimensiones.push({ id: "SELLER_SKU", value_name: producto.sku });

  // 3.8 — categoría + atributos obligatorios, con caché compartido entre cuentas.
  const claveCache = `${siteId}::${titulo}`;
  if (!categoriasCache[claveCache]) {
    const categoriaManual = (producto.categoriasOverride ?? {})[claveCache];
    const cat = categoriaManual ? await leerCategoriaPorId(categoriaManual) : await resolverCategoria(siteId, titulo, token);
    const { atributos, asumidos, emptyGtinReasonDef, brandDef, paqueteIds } = await resolverAtributosObligatorios(cat.categoryId, atributosExtra, titulo);
    categoriasCache[claveCache] = { categoryId: cat.categoryId, categoryName: cat.categoryName, atributos, asumidos, emptyGtinReasonDef, brandDef, paqueteIds };
  }
  const { categoryId, categoryName, asumidos, emptyGtinReasonDef, brandDef, paqueteIds } = categoriasCache[claveCache];

  // 3.9 — los 4 del paquete, con el ID correcto (mayúscula/minúscula según la categoría).
  if (dim.peso) atributosDimensiones.push({ id: paqueteIds.peso, value_name: `${dim.peso} g` });
  if (dim.largo) atributosDimensiones.push({ id: paqueteIds.largo, value_name: `${dim.largo} cm` });
  if (dim.ancho) atributosDimensiones.push({ id: paqueteIds.ancho, value_name: `${dim.ancho} cm` });
  if (dim.alto) atributosDimensiones.push({ id: paqueteIds.alto, value_name: `${dim.alto} cm` });

  // 3.10 — GTIN/EMPTY_GTIN_REASON, árbol de decisión completo, siempre se manda algo.
  atributosDimensiones.push(decidirAtributoGtin(atributosExtra.GTIN, emptyGtinReasonDef));

  // 3.11 — BRAND genérica proactiva, solo si nadie puso una marca real.
  if (!atributosExtra.BRAND) {
    const generica = marcaGenerica(brandDef);
    if (generica) atributosDimensiones.push({ id: "BRAND", value_name: generica.name });
  }

  // 3.12 — merge sin duplicar: lo construido acá (SKU, paquete, GTIN, BRAND) GANA.
  const idsYaIncluidos = new Set(atributosDimensiones.map((a) => a.id));
  const atributos = [...atributosDimensiones, ...categoriasCache[claveCache].atributos.filter((a) => !idsYaIncluidos.has(a.id))];

  // 3.13 — variantes clásicas: los ejes NUNCA van en "attributes".
  const ejesVariante = producto.variantes?.ejes ?? [];
  const combinaciones = producto.variantes?.combinaciones ?? [];
  const ejeFoto = producto.variantes?.ejeFoto ?? null;
  const usaVariantes = ejesVariante.length > 0 && combinaciones.length > 0;
  const idsEjes = new Set(ejesVariante);
  const atributosFinal = usaVariantes ? atributos.filter((a) => !idsEjes.has(a.id) && a.id !== "SELLER_SKU") : atributos;

  // 3.14 — fotos: portada primero, galería, portadas por variante al final; dedupe + tope por categoría.
  const portadasPorVariante = datosCuenta.portadasPorVariante ?? {};
  const urlsPortadasVariante = Object.values(portadasPorVariante).filter(Boolean);
  const galeria = (producto.imagenes ?? []).map((img) => img.url);
  const limiteFotos = await obtenerLimiteFotos(categoryId);
  const pictures = Array.from(new Set([portadaUrl, ...galeria, ...urlsPortadasVariante].filter((u): u is string => Boolean(u))))
    .slice(0, limiteFotos)
    .map((url) => ({ source: url }));

  // 3.15 — bodyBase. listing_type_id/garantía/moneda son reglas de negocio fijas (reunión 31/8).
  const precioBase = Number(producto.precio);
  const bodyBase: Record<string, unknown> = {
    category_id: categoryId,
    currency_id: CURRENCY_POR_SITE[siteId] ?? "COP",
    buying_mode: "buy_it_now",
    condition: producto.condicion || "new",
    listing_type_id: LISTING_TYPE_POR_DEFECTO,
    pictures,
    attributes: atributosFinal,
    sale_terms: [
      { id: "WARRANTY_TYPE", value_name: "Garantía del vendedor" },
      { id: "WARRANTY_TIME", value_name: "30 días" },
    ],
  };
  if (usaVariantes) {
    bodyBase.variations = combinaciones.map((c) => ({
      attribute_combinations: ejesVariante.map((ejeId) => ({ id: ejeId, value_name: c.valores[ejeId] })),
      price: Number(c.precio) || precioBase,
      available_quantity: limitarStock(Number(c.stock) || 1),
      seller_custom_field: c.sku || undefined,
    }));
  } else {
    bodyBase.price = precioBase;
    bodyBase.available_quantity = limitarStock(producto.stock);
  }
  if (producto.envioGratis) bodyBase.shipping = { free_shipping: true };

  // 3.16 — crear, con reintento family_name→title (nunca los dos juntos).
  // Tarea 2.11, punto 2: el fetch directo se movió a crearItemMl
  // (lib/ml/cliente.ts) — acá solo queda la lógica de reintento, igual
  // que antes.
  async function intentarCrear(campoTitulo: "family_name" | "title") {
    const b = { ...bodyBase, [campoTitulo]: truncarTitulo(titulo) };
    const r = await crearItemMl(token, b);
    return { r, b };
  }

  let campoTituloUsado: "family_name" | "title" = "family_name";
  let { r, b: body } = await intentarCrear(campoTituloUsado);
  if (!usaVariantes && !r.ok && esErrorDeFamilyName(r.textoCrudo)) {
    campoTituloUsado = "title";
    ({ r, b: body } = await intentarCrear(campoTituloUsado));
  }

  // 3.17 — reintento automático con marca genérica (solo si la categoría ofrece una opción real).
  let seCambioMarcaAGenerica = false;
  if (!r.ok && exigeGtinPorMarca(r.textoCrudo)) {
    const generica = marcaGenerica(brandDef);
    if (generica) {
      bodyBase.attributes = [...(bodyBase.attributes as { id: string; value_name: string }[]).filter((a) => a.id !== "BRAND"), { id: "BRAND", value_name: generica.name }];
      ({ r, b: body } = await intentarCrear(campoTituloUsado));
      seCambioMarcaAGenerica = true;
    }
  }

  // 3.18 — manejo de fallo: User Products / dimensiones faltantes / genérico.
  if (!r.ok) {
    if (usaVariantes && esRechazoDeVariantesPorCategoria(r.textoCrudo)) {
      return publicarFamiliaUserProducts(cuenta, producto, token, siteId, categoryId, categoryName, titulo, descripcion, portadaUrl, atributosFinal, limiteFotos);
    }
    const errorFinal = faltanDimensionesPaquete(r.textoCrudo)
      ? "Faltan las dimensiones del paquete (peso, largo, ancho y/o alto) — Mercado Libre las exige para calcular el envío. Complétalas en el formulario y vuelve a intentar."
      : r.status === 0
        ? "Mercado Libre no respondió a tiempo; revisá en Mercado Libre si la publicación se creó antes de reintentar."
        : r.textoCrudo.slice(0, 2000);
    return { cuentaMlId: cuenta.id, ok: false, categoria: categoryName, error: errorFinal, bodyEnviado: body };
  }

  const data = r.data!;

  // 3.19 — picture_ids por variante, segundo PUT. Doble supuesto declarado
  // y sin confirmar en vivo (orden pictures↔picture_ids, variations[i]↔
  // body.variations[i]) — nunca hace fallar la publicación si no calza.
  let avisoFotosVariante: string | null = null;
  const picturesData = data.pictures as { id?: string }[] | undefined;
  const variationsData = data.variations as { id: string }[] | undefined;
  if (usaVariantes && ejeFoto && urlsPortadasVariante.length && Array.isArray(picturesData) && Array.isArray(variationsData)) {
    try {
      const urlsEnviadas = pictures.map((p) => p.source);
      const idPorUrl: Record<string, string> = {};
      urlsEnviadas.forEach((url, i) => {
        if (picturesData[i]?.id) idPorUrl[url] = picturesData[i].id!;
      });
      const bodyVariations = (body as { variations?: { attribute_combinations?: { id: string; value_name: string }[] }[] }).variations;
      const variationsConFoto = variationsData
        .map((v, i) => {
          const valorEjeFoto = bodyVariations?.[i]?.attribute_combinations?.find((a) => a.id === ejeFoto)?.value_name;
          const urlFoto = valorEjeFoto ? portadasPorVariante[valorEjeFoto] : null;
          const picId = urlFoto ? idPorUrl[urlFoto] : null;
          return picId ? { id: v.id, picture_ids: [picId] } : null;
        })
        .filter((v): v is { id: string; picture_ids: string[] } => Boolean(v));

      if (variationsConFoto.length) {
        const putR = await actualizarItemMl(data.id as string, token, { variations: variationsConFoto });
        if (!putR.ok) {
          avisoFotosVariante = `Se publicó bien, pero no se pudieron asignar las portadas por variante (Mercado Libre respondió ${putR.status}).`;
        }
      }
    } catch (e) {
      avisoFotosVariante = `Se publicó bien, pero no se pudieron asignar las portadas por variante: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 3.20 — descripción, endpoint separado (NO va en el body de /items).
  // Mejora deliberada sobre el original: si falla, se avisa en vez de
  // tragarse el error en silencio (hallazgo §16.6 del reporte).
  let avisoDescripcion: string | null = null;
  if (descripcion) {
    try {
      const descR = await agregarDescripcionItemMl(data.id as string, token, descripcion);
      if (!descR.ok) avisoDescripcion = `Se publicó bien, pero la descripción no se pudo guardar (Mercado Libre respondió ${descR.status}).`;
    } catch {
      avisoDescripcion = "Se publicó bien, pero la descripción no se pudo guardar.";
    }
  }

  // 3.21 — modo prueba: se pausa de inmediato para que nunca quede
  // visible al público. Riesgo real conocido (item.status.not_modifiable
  // si ML está revisando el ítem, under_review): el PUT falla y el
  // producto queda visible — se tolera igual que el original, pero
  // queda honestamente reflejado en `status` (nunca se informa "paused"
  // si en realidad no se logró pausar).
  let estadoFinal = data.status as string;
  if (producto.modoPrueba) {
    try {
      const pausaR = await actualizarItemMl(data.id as string, token, { status: "paused" });
      if (pausaR.ok) estadoFinal = "paused";
    } catch {
      // se tolera — el estado real queda reflejado tal cual en `estadoFinal`
    }
  }

  // 3.22 — return de éxito. atributos_asumidos es el mecanismo de
  // transparencia ("esto no lo llenó nadie, lo puse yo") — parte del
  // contrato con el usuario, no un detalle interno.
  return {
    cuentaMlId: cuenta.id,
    ok: true,
    itemId: data.id as string,
    permalink: data.permalink as string,
    categoria: categoryName,
    atributosAsumidos: asumidos,
    status: estadoFinal,
    modoPrueba: !!producto.modoPrueba,
    avisoFotosVariante,
    avisoMarca: seCambioMarcaAGenerica
      ? `Mercado Libre exigía código de barras real por la marca puesta — se publicó con marca "Genérica" en su lugar.`
      : null,
    avisoDescripcion,
  };
}

// Reusa la publicación recién creada en la tabla `publicaciones` (tarea
// 2.5/2.6) en vez de esperar al próximo reimport — mejora real sobre el
// sistema actual (ahí productos_ml y publicaciones nunca se enlazaban al
// publicar): así aparece de inmediato en /panel/sku para enlazar su SKU.
async function sincronizarPublicacionCreada(
  empresaId: string,
  cuentaMlId: string,
  publicacionIdExterno: string,
  titulo: string,
  precio: string,
  stock: number
): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicaciones)
      .values({ empresaId, cuentaMlId, publicacionIdExterno, titulo, precio, stock })
      .onConflictDoUpdate({ target: [publicaciones.empresaId, publicaciones.publicacionIdExterno], set: { titulo, precio, stock } })
  );
}

// §2 — el orquestador. SECUENCIAL, no paralelo (igual que el original:
// una cuenta que explote nunca tumba a las demás, se degrada a
// {ok:false, error}) — con el refresh de token por cuenta (tarea 2.3),
// paralelizar sería una condición de carrera real sobre el mismo token.
export async function publicarProductoEnCuentas(empresaId: string, productoId: string): Promise<ResultadoPublicacionCuenta[]> {
  const [producto] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(productosMl).where(eq(productosMl.id, productoId)));
  if (!producto) throw new Error("Producto no encontrado.");

  const cuentasSeleccionadas = producto.cuentasSeleccionadas ?? [];
  const cuentas = await dbComoEmpresa(empresaId, (tx) =>
    cuentasSeleccionadas.length
      ? tx
          .select({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna })
          .from(cuentasMl)
          .where(and(eq(cuentasMl.empresaId, empresaId), inArray(cuentasMl.id, cuentasSeleccionadas), isNull(cuentasMl.desconectadaTs)))
      : tx
          .select({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna })
          .from(cuentasMl)
          .where(and(eq(cuentasMl.empresaId, empresaId), isNull(cuentasMl.desconectadaTs)))
  );

  const categoriasCache: Record<string, CategoriaCacheEntry> = {};
  const resultados: ResultadoPublicacionCuenta[] = [];
  for (const cuenta of cuentas) {
    try {
      const resultado = await publicarProductoEnCuenta(empresaId, cuenta, producto as unknown as ProductoParaPublicar, categoriasCache);
      resultados.push(resultado);
      if (resultado.ok && "itemId" in resultado) {
        await sincronizarPublicacionCreada(empresaId, cuenta.id, resultado.itemId, producto.titulo ?? resultado.categoria, producto.precio, producto.stock).catch(() => null);
      } else if ("familia" in resultado) {
        for (const item of resultado.familia.items) {
          if (item.ok && item.itemId) {
            await sincronizarPublicacionCreada(
              empresaId,
              cuenta.id,
              item.itemId,
              resultado.familia.familyName,
              String(Number(item.sku ? producto.precio : producto.precio)),
              1
            ).catch(() => null);
          }
        }
      }
    } catch (e) {
      resultados.push({ cuentaMlId: cuenta.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  // Bug real evitado (vs. el sistema actual, §2 del reporte): con
  // "cuentas" vacío, 0 === 0 daba estado "publicado" con cero
  // publicaciones reales. Acá, cero cuentas es SIEMPRE "con_errores".
  const estado = resultados.length > 0 && exitosos === resultados.length ? ("publicado" as const) : ("con_errores" as const);
  const nombreInterno = Object.values(producto.porCuenta ?? {})[0]?.titulo || "(sin título)";

  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.update(productosMl).set({ estado, resultado: resultados, publicadoTs: new Date(), titulo: nombreInterno }).where(eq(productosMl.id, productoId));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId: producto.creadoPorUsuarioId,
      actorTipo: "persona",
      accion: "publicó un producto nuevo en Mercado Libre",
      entidad: "Mercado Libre",
      detalle: `${nombreInterno} — ${exitosos} de ${resultados.length} cuentas exitosas`,
    });
  });

  return resultados;
}
