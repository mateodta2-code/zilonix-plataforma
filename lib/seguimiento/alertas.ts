// Issue #175 — comparación pura entre la foto de ayer y la de hoy,
// SIN ningún fetch ni acceso a Postgres: toda llamada a Mercado Libre
// pasa por lib/ml/cliente.ts (regla de CLAUDE.md), y la foto de hoy ya
// viene resuelta por lib/trabajos/revisionDiariaSeguimiento.ts antes de
// llegar hasta acá. Separado a propósito para poder probar la lógica
// de negocio real (qué cuenta como alerta y con qué detalle) con datos
// simulados, nunca contra la API real (pedido explícito del issue).
//
// Cada alerta es un hecho objetivo observado entre las dos fotos —
// nunca una opinión. "Posible venta" no es un tipo de alerta aparte:
// es el texto que arma mensajeAlerta() a partir de "inventario_bajo" +
// las unidades, porque Mercado Libre nunca confirma que esa baja de
// stock fue una venta real (podría ser el vendedor ajustando stock a
// mano) — se dice "posible", nunca "vendió".

export type AlertaSeguimientoTipo =
  | "precio_bajo"
  | "precio_subio"
  | "entro_catalogo"
  | "salio_catalogo"
  | "gano_boton_compra"
  | "perdio_boton_compra"
  | "inventario_bajo"
  | "pausada"
  | "finalizada"
  | "publicacion_nueva"
  | "publicacion_eliminada";

export type AlertaGenerada = { tipo: AlertaSeguimientoTipo; detalle: Record<string, unknown> };

export type PublicacionTienda = { itemId: string; titulo: string; precio: number | null };

// Mismas columnas reales de seguimiento_fotos (db/schema.ts) que
// importan para comparar — nunca el campo id/empresaId/fecha, que no
// participan de ninguna regla de alerta.
export type FotoComparable = {
  precio: number | null;
  inventarioDisponible: number | null;
  estado: string | null;
  enCatalogo: boolean | null;
  ganaBotonCompra: boolean | null;
  publicaciones: PublicacionTienda[] | null;
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
// (ej. falló la búsqueda de publicaciones ese día puntual).
function alertasDePublicaciones(anterior: FotoComparable, actual: FotoComparable): AlertaGenerada[] {
  if (!anterior.publicaciones || !actual.publicaciones) return [];
  const idsAnterior = new Set(anterior.publicaciones.map((p) => p.itemId));
  const idsActual = new Set(actual.publicaciones.map((p) => p.itemId));

  const nuevas = actual.publicaciones.filter((p) => !idsAnterior.has(p.itemId));
  const eliminadas = anterior.publicaciones.filter((p) => !idsActual.has(p.itemId));

  const alertas: AlertaGenerada[] = [];
  if (nuevas.length > 0) alertas.push({ tipo: "publicacion_nueva", detalle: { publicaciones: nuevas } });
  if (eliminadas.length > 0) alertas.push({ tipo: "publicacion_eliminada", detalle: { publicaciones: eliminadas } });
  return alertas;
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
    ...alertasDeEstado(anterior, actual),
  ];
  if (tipo === "tienda") alertas.push(...alertasDePublicaciones(anterior, actual));
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
    case "pausada":
      return "La publicación quedó pausada.";
    case "finalizada":
      return "La publicación finalizó.";
    case "publicacion_nueva": {
      const publicaciones = d.publicaciones as PublicacionTienda[];
      return publicaciones.length === 1
        ? `Publicación nueva: ${publicaciones[0].titulo}.`
        : `${publicaciones.length} publicaciones nuevas.`;
    }
    case "publicacion_eliminada": {
      const publicaciones = d.publicaciones as PublicacionTienda[];
      return publicaciones.length === 1
        ? `Publicación eliminada: ${publicaciones[0].titulo}.`
        : `${publicaciones.length} publicaciones eliminadas.`;
    }
  }
}
