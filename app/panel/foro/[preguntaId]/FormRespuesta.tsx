"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { AdjuntarImagen } from "../AdjuntarImagen";
import { crearRespuestaAction } from "../actions";
import styles from "../page.module.css";

const RESPUESTA_MAX = 5000;

export function FormRespuesta({ preguntaId }: { preguntaId: string }) {
  const router = useRouter();
  const [cuerpo, setCuerpo] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const resultado = await crearRespuestaAction(preguntaId, cuerpo, imagenUrl);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setCuerpo("");
    setImagenUrl(null);
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
      <AdjuntarImagen url={imagenUrl} onCambio={setImagenUrl} onSubiendo={setSubiendoImagen} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={enviando || subiendoImagen}>
          {enviando ? "Publicando…" : "Responder"}
        </Boton>
      </div>
    </form>
  );
}
