import type { EstadoChip } from "@/components/marco/Chip";
import type { EstadoTicket } from "@/lib/soporte/validacion";

export { formatoFechaForo as formatoFechaTicket } from "../foro/formato";

export const CHIP_ESTADO_TICKET: Record<EstadoTicket, EstadoChip> = {
  abierto: "aviso",
  en_curso: "advertencia",
  resuelto: "exito",
};
