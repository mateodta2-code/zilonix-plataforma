"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { LIMITES_SOPORTE } from "@/lib/soporte/validacion";
import { AdjuntarCapturas, aFormData } from "@/components/soporte/AdjuntarCapturas";
import { responderTicketAction } from "../actions";
import styles from "../page.module.css";

export function FormMensaje({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [imagenes, setImagenes] = useState<Blob[]>([]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const resultado = await responderTicketAction(ticketId, mensaje, aFormData(imagenes));
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setMensaje("");
    setImagenes([]);
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className={styles.formulario}>
      <Campo etiqueta="Tu mensaje">
        <textarea className="zx-control" value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={LIMITES_SOPORTE.respuestaMax} rows={4} required />
      </Campo>
      <AdjuntarCapturas imagenes={imagenes} onChange={setImagenes} deshabilitado={enviando} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar mensaje"}
        </Boton>
      </div>
    </form>
  );
}
