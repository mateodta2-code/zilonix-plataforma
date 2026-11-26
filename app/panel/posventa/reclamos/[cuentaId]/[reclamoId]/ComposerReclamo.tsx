"use client";

import { ComposerPosventa } from "@/components/posventa/ComposerPosventa";
import { REGLAS_ADJUNTO_RECLAMO } from "@/lib/posventa/adjuntos";
import { puedeEscribirEnReclamo } from "@/lib/posventa/reclamoAcciones";
import { urlReclamoEnMl, type PropsAccionesReclamo } from "./AccionesReclamo";
import { enviarMensajeReclamoAction, sugerirRespuestaReclamoAction } from "./accionesMensaje";

// Posventa-Mensajes (Refs #645): el hueco de Reclamos-A ahora escribe de
// verdad, pero solo si ML le habilita al vendedor send_message_to_* (según
// la etapa). Si no, la caja queda cerrada con el motivo y el link a ML.
export function ComposerReclamo({ siteId, ordenId, reclamoId, cuentaId, etapa, accionesVendedor, iaConectada, sinPermiso }: PropsAccionesReclamo & { iaConectada: boolean; sinPermiso: boolean }) {
  const habilitado = puedeEscribirEnReclamo(etapa, accionesVendedor);
  const motivo = sinPermiso ? "Tu rol no permite responder reclamos." : habilitado ? null : "Mercado Libre no habilita escribir en este reclamo ahora.";
  return (
    <ComposerPosventa
      reglas={REGLAS_ADJUNTO_RECLAMO}
      enviar={enviarMensajeReclamoAction}
      campos={{ cuentaId, reclamoId }}
      sugerir={() => sugerirRespuestaReclamoAction({ cuentaId, reclamoId })}
      iaConectada={iaConectada}
      bloqueadoMotivo={motivo}
      enlaceMl={urlReclamoEnMl(siteId, ordenId)}
    />
  );
}
