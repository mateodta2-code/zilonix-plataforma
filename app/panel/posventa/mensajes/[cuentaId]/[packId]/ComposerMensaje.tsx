"use client";

import { ComposerPosventa } from "@/components/posventa/ComposerPosventa";
import { REGLAS_ADJUNTO_MENSAJE } from "@/lib/posventa/adjuntos";
import { enviarMensajeVentaAction, sugerirRespuestaVentaAction } from "../../acciones";

export function ComposerMensaje({ cuentaId, packId, iaConectada, sinPermiso, producto, variacion }: { cuentaId: string; packId: string; iaConectada: boolean; sinPermiso: boolean; producto: string | null; variacion: string | null }) {
  return (
    <ComposerPosventa
      reglas={REGLAS_ADJUNTO_MENSAJE}
      enviar={enviarMensajeVentaAction}
      campos={{ cuentaId, packId }}
      sugerir={() => sugerirRespuestaVentaAction({ cuentaId, packId, producto, variacion })}
      iaConectada={iaConectada}
      bloqueadoMotivo={sinPermiso ? "Tu rol no permite responder mensajes." : null}
    />
  );
}
