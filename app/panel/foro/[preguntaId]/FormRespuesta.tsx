"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { crearRespuestaAction } from "../actions";
import styles from "../page.module.css";

const RESPUESTA_MAX = 5000;

export function FormRespuesta({ preguntaId }: { preguntaId: string }) {
  const router = useRouter();
  const [cuerpo, setCuerpo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const resultado = await crearRespuestaAction(preguntaId, cuerpo);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setCuerpo("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className={styles.formulario}>
      <Campo etiqueta="Tu respuesta">
        <textarea
          className="zx-control"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          maxLength={RESPUESTA_MAX}
          rows={4}
          required
          placeholder="Comparte lo que te ha funcionado."
        />
      </Campo>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={enviando}>
          {enviando ? "Publicando…" : "Responder"}
        </Boton>
      </div>
    </form>
  );
}
