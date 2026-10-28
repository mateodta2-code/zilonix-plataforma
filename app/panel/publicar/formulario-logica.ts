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
// (categoriasOverride). `SITE_ID` siempre "MCO" en esta fase (único
// país en alcance, ver lib/ml/cliente.ts) — nunca se pide a la persona
// que lo escriba a mano.
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
