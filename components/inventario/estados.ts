import type { EstadoChip } from "@/components/marco/Chip";

// Issue #280 — etiqueta y color de cada estado de una orden de compra.
export const ESTADO_OC: Record<string, { texto: string; estado: EstadoChip }> = {
  abierta: { texto: "Abierta", estado: "aviso" },
  parcial: { texto: "Parcial", estado: "aviso" },
  recibida: { texto: "Recibida", estado: "exito" },
  anulada: { texto: "Anulada", estado: "neutro" },
};
