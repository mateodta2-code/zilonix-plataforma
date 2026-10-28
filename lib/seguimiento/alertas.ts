// Issue #175 — comparación pura entre la foto de ayer y la de hoy,
// SIN ningún fetch ni acceso a Postgres: toda llamada a Mercado Libre
// pasa por lib/ml/cliente.ts (regla de CLAUDE.md), y la foto de hoy ya
// viene resuelta por lib/trabajos/revisionDiariaSeguimiento.ts antes de
// llegar hasta acá. Separado a propósito para poder probar la lógica
// de negocio real (qué cuenta como alerta y con qué detalle) con datos
// simulados, nunca contra la API real (pedido explícito del issue).
//
// Cada alerta es un hecho objetivo observado entre las dos fotos —
// nunca una opinión. "Posible venta" (inventario_bajo) no es una
// confirmación de venta real: Mercado Libre nunca dice que una baja de
// stock fue una venta (podría ser el vendedor ajustando stock a mano),
// por eso el mensaje dice "posible", nunca "vendió". "vendio_unidades"
// es la alerta aparte, más confiable, que sí usa el contador real de
// Mercado Libre (sold_quantity, acumulado histórico de la publicación)
// — la resta entre dos sold_quantity reales SÍ son ventas reales
// confirmadas por Mercado Libre, a diferencia del inventario.

export type AlertaSeguimientoTipo =
  | "precio_bajo"
  | "precio_subio"
  | "entro_catalogo"
  | "salio_catalogo"
  | "gano_boton_compra"
  | "perdio_boton_compra"
  | "inventario_bajo"
  | "vendio_unidades"
  | "pausada"
  | "finalizada"
  | "publicacion_nueva"
  | "publicacion_eliminada";

export type AlertaGenerada = { tipo: AlertaSeguimientoTipo; detalle: Record<string, unknown> };

// Issue #251, punto 5 — `titulo` pasa a `string | null`: la lectura de
// página de una tienda (guardarDatoDePaginaSeguimiento) solo trae el
// `itemId` de cada publicación visible, nunca su título real — antes
// se rellenaba con el propio `itemId` como título falso, que Pablo
// pidió sacar. `null` es honesto; quien muestra el mensaje cae al
// `itemId` recién AHÍ, nunca se inventa un título guardado.
export type PublicacionTienda = { itemId: string; titulo: string | null; precio: number | null };

// Issue #251, punto 5 — `total` (el número real que Mercado Libre
// muestra arriba del listado) viaja junto con `visibles` (el snapshot
// liviano que ya usaba la comparación de nuevas/eliminadas) dentro del
// mismo campo jsonb, sin columna aparte. `fuente` (corrección de
// Pablo) distingue si ESTA foto vino de la API (visibles = snapshot
// completo real) o de la página leída por la extensión (visibles =
// solo lo visible en esa carga, ~48, nunca el total) — alertasDePublicaciones
// (más abajo) la usa para no comparar nuevas/eliminadas entre dos
// snapshots que nunca fueron completos.
export type PublicacionesTienda = { total: number | null; visibles: PublicacionTienda[]; fuente: "api" | "pagina" };

// Issue #251 (corrección de Pablo, punto 3) — `seguimiento_fotos.publicaciones`
// guardó, antes de `total`/`fuente`, un array PLANO de `visibles`
// directo (sin envolver) — leer esa fila vieja y tratarla como
// `PublicacionesTienda` (ej. `.visibles.map(...)`) revienta en
// producción, porque un array no tiene `.visibles`. Todo lector de
// esta columna (aFotoComparable, la lista y el detalle de Seguimiento)
// pasa por acá ANTES de usar `.total`/`.visibles` — nunca confía en
// que el jsonb ya viene con la forma nueva. Una fila vieja se asume
// "api": ese formato nunca existió para una lectura de la extensión
// (la extensión, y el campo `fuente`, llegaron juntos en este mismo
// punto).
export function normalizarPublicaciones(raw: unknown): PublicacionesTienda | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return { total: null, visibles: raw as PublicacionTienda[], fuente: "api" };
  if (typeof raw !== "object") return null;
  const obj = raw as { total?: unknown; visibles?: unknown; fuente?: unknown };
  if (!("visibles" in obj)) return null; // es el otro formato que vive en esta misma columna — ver obtenerVendidosAproximado
  return {
    total: typeof obj.total === "number" ? obj.total : null,
    visibles: Array.isArray(obj.visibles) ? (obj.visibles as PublicacionTienda[]) : [],
    fuente: obj.fuente === "pagina" ? "pagina" : "api",
  };
}

// Issue #252 (smoke de staging) — para tipo = "producto", la MISMA
// columna `publicaciones` (nunca una columna nueva, sin migración —
// ver el comentario en db/schema.ts) guarda `{vendidosAproximado}`:
// el piso "+N vendidos" de la ficha, cuando Mercado Libre no deja ver
// el número exacto (`seguimiento_fotos.vendidos` queda reservado al
// exacto — nunca se compara en alertas, ver compararFotos más abajo,
// que solo mira `publicaciones` para tipo="tienda"). Nunca se confunde
// con el formato de tienda: ese siempre tiene `visibles`, este nunca.
export function obtenerVendidosAproximado(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { vendidosAproximado?: unknown };
  return typeof obj.vendidosAproximado === "number" ? obj.vendidosAproximado : null;
}

// Issue #252 (smoke de staging) — mismo criterio que
// obtenerVendidosAproximado: el precio que la extensión lee de la
// página (respaldo cuando Mercado Libre nunca confirma uno real por
// la API para este producto) vive en la MISMA columna, bajo
// `precioAproximado` — nunca confundido con `vendidosAproximado` ni
// con el formato de tienda.
export function obtenerPrecioAproximado(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { precioAproximado?: unknown };
  return typeof obj.precioAproximado === "number" ? obj.precioAproximado : null;
}

// Issue #251 ("Seguimiento muestra aproximados como Selltrix") —
// mismo criterio que obtenerVendidosAproximado/obtenerPrecioAproximado:
// para tipo = "producto", esta MISMA columna también guarda
// `fechaCreacion` (date_created real de Mercado Libre, cuando la API
// lo confirma) — a diferencia de los otros dos campos, este SOLO lo
// escribe el cron (lib/trabajos/revisionDiariaSeguimiento.ts), nunca
// la extensión: es un dato que la API sí puede confirmar, no un
// respaldo de la página. lib/seguimiento/aproximados.ts lo usa para la
// antigüedad real de la publicación; si viene null, esa misma función
// cae a interpolar por el id.
export function obtenerFechaCreacion(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { fechaCreacion?: unknown };
  return typeof obj.fechaCreacion === "string" ? obj.fechaCreacion : null;
}

// Issue #262 (revisión de Pablo, punto 2) — date_created real del
// CATÁLOGO (recursoMl "product"), nunca el de una oferta/ítem ganador
// — campo APARTE de `fechaCreacion` (arriba, que es real solo para
// recursoMl "item"). Quien calcula antigüedad para un seguimiento
// "product" tiene que leer ESTE campo, nunca `obtenerFechaCreacion` —
// ver lib/seguimiento/lector.ts para por qué están separados.
export function obtenerFechaCreacionCatalogo(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { fechaCreacionCatalogo?: unknown };
  return typeof obj.fechaCreacionCatalogo === "string" ? obj.fechaCreacionCatalogo : null;
}

// Issue #262 (revisión de Pablo, punto 2) — un solo punto de entrada
// para "qué date_created real usar para antigüedad", según el tipo de
// recurso real del seguimiento — nunca se adivina cuál campo leer en
// cada pantalla por separado (el bug bloqueante de esta revisión era
// justo eso: alguien leyendo el campo equivocado). "item" ->
// fechaCreacion (del ítem puntual); "product" -> fechaCreacionCatalogo
// (del catálogo, nunca de una oferta ganadora); "seller" o null -> una
// tienda no tiene date_created propio, siempre null.
export function obtenerFechaCreacionParaAntiguedad(raw: unknown, recursoMl: "item" | "product" | "seller" | null): string | null {
  if (recursoMl === "item") return obtenerFechaCreacion(raw);
  if (recursoMl === "product") return obtenerFechaCreacionCatalogo(raw);
  return null;
}

// Mismas columnas reales de seguimiento_fotos (db/schema.ts) que
// importan para comparar — nunca el campo id/empresaId/fecha, que no
// participan de ninguna regla de alerta.
export type FotoComparable = {
  precio: number | null;
  inventarioDisponible: number | null;
  vendidos: number | null;
  estado: string | null;
  enCatalogo: boolean | null;
  ganaBotonCompra: boolean | null;
  publicaciones: PublicacionesTienda | null;
};

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Precio: solo compara cuando LAS DOS fotos trajeron un precio real
// (nunca null) — un precio "no disponible" en cualquiera de las dos
// puntas no es "bajó a 0", es un dato ausente, y una alerta sobre un
// dato ausente sería inventada.
function alertasDePrecio(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.precio == null || actual.precio == null || anterior.precio === actual.precio) return [];
  const porcentaje = redondear2(((actual.precio - anterior.precio) / anterior.precio) * 100);
  const detalle = { precioAnterior: anterior.precio, precioNuevo: actual.precio, porcentaje };
  return [{ tipo: actual.precio < anterior.precio ? "precio_bajo" : "precio_subio", detalle }];
}

function alertasDeCatalogo(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.enCatalogo == null || actual.enCatalogo == null || anterior.enCatalogo === actual.enCatalogo) return [];
  return [{ tipo: actual.enCatalogo ? "entro_catalogo" : "salio_catalogo", detalle: {} }];
}

function alertasDeBotonCompra(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.ganaBotonCompra == null || actual.ganaBotonCompra == null || anterior.ganaBotonCompra === actual.ganaBotonCompra) return [];
  return [{ tipo: actual.ganaBotonCompra ? "gano_boton_compra" : "perdio_boton_compra", detalle: {} }];
}

// Solo BAJA de inventario — issue explícito: "bajó el inventario
// (posible venta, con las unidades)". Una subida es un reabasto, nunca
// una alerta (el issue no pide avisar eso, y avisar algo que nadie
// pidió sería inventar alcance).
function alertasDeInventario(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.inventarioDisponible == null || actual.inventarioDisponible == null) return [];
  if (actual.inventarioDisponible >= anterior.inventarioDisponible) return [];
  const unidades = anterior.inventarioDisponible - actual.inventarioDisponible;
  return [{ tipo: "inventario_bajo", detalle: { inventarioAnterior: anterior.inventarioDisponible, inventarioActual: actual.inventarioDisponible, unidades } }];
}

// Pedido explícito: "vendió N unidades desde la última revisión" =
// sold_quantity de hoy − el de ayer, SOLO si los dos son números
// reales (nunca estimados) — sold_quantity es un contador acumulado
// histórico que Mercado Libre nunca hace bajar (a diferencia del
// inventario, que puede subir por un reabasto) — por eso alcanza con
// "aumentó" sin necesitar un chequeo de dirección como en inventario.
function alertasDeVendidos(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.vendidos == null || actual.vendidos == null) return [];
  const unidades = actual.vendidos - anterior.vendidos;
  if (unidades <= 0) return [];
  return [{ tipo: "vendio_unidades", detalle: { vendidosAnterior: anterior.vendidos, vendidosActual: actual.vendidos, unidades } }];
}

// Vocabulario real de Mercado Libre para `status` (confirmado contra
// producción: lib/ml/cliente.ts, obtenerItemMl, ya compara contra
// "active" con el mismo literal) — nunca inventado acá.
const ESTADO_ML_ACTIVO = "active";
const ESTADO_ML_PAUSADO = "paused";
const ESTADO_ML_CERRADO = "closed";

// Solo las dos transiciones que pide el issue ("pausada o
// finalizada") — nunca se inventa una tercera (ej. "reactivada") que
// nadie pidió. Siempre desde "active" real: una publicación que ya
// estaba pausada y sigue pausada no es una transición nueva.
function alertasDeEstado(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (anterior.estado !== ESTADO_ML_ACTIVO) return [];
  if (actual.estado === ESTADO_ML_PAUSADO) return [{ tipo: "pausada", detalle: {} }];
  if (actual.estado === ESTADO_ML_CERRADO) return [{ tipo: "finalizada", detalle: {} }];
  return [];
}

// Solo aplica a tipo = "tienda" — el llamador (compararFotos) ya
// decide cuándo llamar esta función; acá solo se protege con
// null-checks por si alguna de las dos fotos no trajo el snapshot
// (ej. falló la búsqueda de publicaciones ese día puntual). Issue #251
// (corrección de Pablo, punto 4) — solo se llama cuando LAS DOS fotos
// son `fuente: "api"` (snapshot completo real): si cualquiera de las
// dos viene de la página (visibles = solo lo visible en esa carga,
// ~48, nunca el total), comparar esos ids marcaría "nuevas"/"eliminadas"
// falsas solo por el paginado real de Mercado Libre — ver
// alertasDeTotalPublicaciones, la alerta real para ese caso.
function alertasDePublicaciones(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (!anterior.publicaciones || !actual.publicaciones) return [];
  const idsAnterior = new Set(anterior.publicaciones.visibles.map((p) => p.itemId));
  const idsActual = new Set(actual.publicaciones.visibles.map((p) => p.itemId));

  const nuevas = actual.publicaciones.visibles.filter((p) => !idsAnterior.has(p.itemId));
  const eliminadas = anterior.publicaciones.visibles.filter((p) => !idsActual.has(p.itemId));

  const alertas: AlertaGenerada[] = [];
  if (nuevas.length > 0) alertas.push({ tipo: "publicacion_nueva", detalle: { publicaciones: nuevas } });
  if (eliminadas.length > 0) alertas.push({ tipo: "publicacion_eliminada", detalle: { publicaciones: eliminadas } });
  return alertas;
}

// Issue #251 (corrección de Pablo, punto 4) — cuando cualquiera de las
// dos fotos viene de la página, la única comparación honesta es el
// TOTAL real (el que Mercado Libre muestra arriba del listado, nunca
// el conteo de `visibles`). Reusa los mismos dos tipos de alerta que
// alertasDePublicaciones (sin agregar un valor nuevo al enum de
// Postgres, que necesitaría una migración) — `detalle.estimadoPorTotal`
// distingue, para mensajeAlerta, que este caso no trae la lista real
// de publicaciones, solo el cambio del número.
function alertasDeTotalPublicaciones(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (!anterior.publicaciones || !actual.publicaciones) return [];
  if (anterior.publicaciones.total == null || actual.publicaciones.total == null) return [];
  const diferencia = actual.publicaciones.total - anterior.publicaciones.total;
  if (diferencia === 0) return [];
  const detalle = { estimadoPorTotal: true, totalAnterior: anterior.publicaciones.total, totalActual: actual.publicaciones.total, diferencia: Math.abs(diferencia) };
  return [{ tipo: diferencia > 0 ? "publicacion_nueva" : "publicacion_eliminada", detalle }];
}

// Orquesta todas las reglas de arriba. `tipo` decide si corresponde
// comparar publicaciones (solo "tienda") — un seguimiento de
// "producto" nunca trae ese campo poblado, pero ser explícito con el
// tipo evita depender de que publicaciones venga o no venga null por
// casualidad.
export function compararFotos(tipo: "producto" | "tienda", anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  const alertas = [
    ...alertasDePrecio(anterior, actual),
    ...alertasDeCatalogo(anterior, actual),
    ...alertasDeBotonCompra(anterior, actual),
    ...alertasDeInventario(anterior, actual),
    ...alertasDeVendidos(anterior, actual),
    ...alertasDeEstado(anterior, actual),
  ];
  if (tipo === "tienda") {
    const algunaDePagina = anterior.publicaciones?.fuente === "pagina" || actual.publicaciones?.fuente === "pagina";
    alertas.push(...(algunaDePagina ? alertasDeTotalPublicaciones(anterior, actual) : alertasDePublicaciones(anterior, actual)));
  }
  return alertas;
}

// Texto en español para una persona, a partir de tipo+detalle — nunca
// guardado en la base (ver el comentario de seguimiento_alertas en
// db/schema.ts): una mejora de redacción futura aplica también a las
// alertas viejas, en vez de quedar congeladas con el texto del día que
// se generaron.
export function mensajeAlerta(alerta: AlertaGenerada): string {
  const d = alerta.detalle;
  switch (alerta.tipo) {
    case "precio_bajo":
      return `Bajó el precio: $${Number(d.precioAnterior).toLocaleString("es-CO")} → $${Number(d.precioNuevo).toLocaleString("es-CO")} (${d.porcentaje}%).`;
    case "precio_subio":
      return `Subió el precio: $${Number(d.precioAnterior).toLocaleString("es-CO")} → $${Number(d.precioNuevo).toLocaleString("es-CO")} (+${d.porcentaje}%).`;
    case "entro_catalogo":
      return "Entró al catálogo de Mercado Libre.";
    case "salio_catalogo":
      return "Salió del catálogo de Mercado Libre.";
    case "gano_boton_compra":
      return "Ganó el botón de compra (catálogo).";
    case "perdio_boton_compra":
      return "Perdió el botón de compra (catálogo).";
    case "inventario_bajo":
      return `Bajó el inventario disponible: ${d.inventarioAnterior} → ${d.inventarioActual} (posible venta de ${d.unidades} unidad${Number(d.unidades) === 1 ? "" : "es"} — Mercado Libre no confirma que fue una venta real).`;
    case "vendio_unidades":
      return `Vendió ${d.unidades} unidad${Number(d.unidades) === 1 ? "" : "es"} desde la última revisión (contador real de Mercado Libre: ${d.vendidosAnterior} → ${d.vendidosActual}).`;
    case "pausada":
      return "La publicación quedó pausada.";
    case "finalizada":
      return "La publicación finalizó.";
    case "publicacion_nueva": {
      // Issue #251 (corrección de Pablo) — cuando la fuente es la
      // página, alertasDeTotalPublicaciones nunca trae la lista real
      // (solo el cambio del total) — mensaje aparte, honesto sobre lo
      // que de verdad se sabe.
      if (d.estimadoPorTotal) {
        return `Subieron las publicaciones: ${d.totalAnterior} → ${d.totalActual} (+${d.diferencia}, estimado por el total leído de la página — sin el detalle de cuáles).`;
      }
      const publicaciones = d.publicaciones as PublicacionTienda[];
      return publicaciones.length === 1
        ? `Publicación nueva: ${publicaciones[0].titulo ?? publicaciones[0].itemId}.`
        : `${publicaciones.length} publicaciones nuevas.`;
    }
    case "publicacion_eliminada": {
      if (d.estimadoPorTotal) {
        return `Bajaron las publicaciones: ${d.totalAnterior} → ${d.totalActual} (−${d.diferencia}, estimado por el total leído de la página — sin el detalle de cuáles).`;
      }
      const publicaciones = d.publicaciones as PublicacionTienda[];
      return publicaciones.length === 1
        ? `Publicación eliminada: ${publicaciones[0].titulo ?? publicaciones[0].itemId}.`
        : `${publicaciones.length} publicaciones eliminadas.`;
    }
  }
}
