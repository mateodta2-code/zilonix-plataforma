// Issue "historial de Publicar — detalle en español" — único lugar que
// traduce el `status` crudo de un ítem de Mercado Libre (active/paused/
// closed/under_review/inactive/...) al español. Antes de esto, el
// historial mostraba literal "publicado (paused)" ([id]/page.tsx) — un
// estado nuevo que Mercado Libre agregue y que todavía no esté en este
// mapa cae al texto genérico, nunca al código en inglés.
export const ETIQUETA_ESTADO_ITEM_ML: Readonly<Record<string, string>> = {
  active: "Activa",
  paused: "Pausada",
  closed: "Finalizada",
  under_review: "En revisión",
  inactive: "Inactiva",
};

export function etiquetaEstadoItemMl(status: string | null | undefined): string {
  if (!status) return "Estado desconocido";
  return ETIQUETA_ESTADO_ITEM_ML[status] ?? "Otro estado";
}

// Mismo criterio que ETIQUETA_ESTADO_ITEM_ML, pero para `sub_status`
// (detalle adicional de Mercado Libre sobre un ítem activo, ej. sin
// stock o con una advertencia de calidad) — nunca el código en inglés.
export const ETIQUETA_SUB_STATUS_ITEM_ML: Readonly<Record<string, string>> = {
  out_of_stock: "Sin stock",
  warning: "Con advertencia",
};

export function etiquetaSubStatusItemMl(subStatus: string | null | undefined): string | null {
  if (!subStatus) return null;
  return ETIQUETA_SUB_STATUS_ITEM_ML[subStatus] ?? "Otro detalle";
}

// Mismo criterio que textoEstado() de zilonix-os-web
// (components/negocio/MercadoLibrePublicar.js, confirmado contra
// producción) — mientras nadie apretó "Ver estado real" en esa cuenta
// (estadoReal null/undefined) se muestra "Publicado (sin verificar)",
// nunca "activo" a secas (eso requiere haber consultado a Mercado
// Libre de verdad). Solo pasa a "Publicado y activo" una vez
// confirmado; cualquier otro estado real muestra su etiqueta en
// español sin inventar que está activo.
export function etiquetaPublicacionCuenta(estadoReal: string | null | undefined): string {
  if (!estadoReal) return "Publicado (sin verificar)";
  if (estadoReal === "active") return "Publicado y activo";
  return `Publicado — ${etiquetaEstadoItemMl(estadoReal)}`;
}
