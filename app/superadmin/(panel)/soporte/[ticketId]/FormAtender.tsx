"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { ESTADOS_TICKET, ETIQUETA_ESTADO_TICKET, LIMITES_SOPORTE, type EstadoTicket } from "@/lib/soporte/validacion";
import styles from "@/app/panel/tickets/page.module.css";
import { AdjuntarCapturas, aFormData } from "@/components/soporte/AdjuntarCapturas";
import { cambiarEstadoTicketAction, responderTicketSuperadminAction } from "../actions";

export function FormAtender({ ticketId, estado }: { ticketId: string; estado: EstadoTicket }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [imagenes, setImagenes] = useState<Blob[]>([]);

  async function correr(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, alExito?: () => void) {
    setOcupado(true);
    setError(null);
    const r = await accion();
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    alExito?.();
    router.refresh();
  }

  return (
    <div className={styles.formulario}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void correr(() => responderTicketSuperadminAction(ticketId, mensaje, aFormData(imagenes)), () => {
            setMensaje("");
            setImagenes([]);
          });
        }}
        className={styles.formulario}
      >
        <Campo etiqueta="Respuesta para la empresa">
          <textarea className="zx-control" value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={LIMITES_SOPORTE.respuestaMax} rows={4} required />
        </Campo>
        <AdjuntarCapturas imagenes={imagenes} onChange={setImagenes} deshabilitado={ocupado} nota="Opcional: hasta 3 imágenes para explicarle a la empresa (por ejemplo, dónde está un botón). Las ve esa empresa y el equipo de soporte." />
        <div className={styles.acciones}>
          <Boton type="submit" disabled={ocupado}>
            {ocupado ? "Enviando…" : "Responder"}
          </Boton>
        </div>
      </form>
      <div className={styles.acciones}>
        <span className={styles.meta}>Estado:</span>
        {ESTADOS_TICKET.map((e) => (
          <Boton key={e} type="button" variante={e === estado ? "primario" : "fantasma"} disabled={ocupado || e === estado} onClick={() => void correr(() => cambiarEstadoTicketAction(ticketId, e))}>
            {ETIQUETA_ESTADO_TICKET[e]}
          </Boton>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
