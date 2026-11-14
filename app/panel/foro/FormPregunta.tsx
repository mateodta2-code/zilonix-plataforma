"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { AdjuntarImagen } from "./AdjuntarImagen";
import { crearPreguntaAction } from "./actions";
import styles from "./page.module.css";

const TITULO_MAX = 150;
const CUERPO_MAX = 5000;

// React 18.3.1: sin useFormState — se llama la acción directo y se
// muestra su error acá, nunca en una pantalla de error aparte.
export function FormPregunta() {
  const router = useRouter();
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const resultado = await crearPreguntaAction(titulo, cuerpo, imagenUrl);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setTitulo("");
    setCuerpo("");
    setImagenUrl(null);
    if (resultado.preguntaId) router.push(`/panel/foro/${resultado.preguntaId}`);
  }

  return (
    <form onSubmit={enviar} className={styles.formulario}>
      <Campo etiqueta="Título de tu pregunta">
        <input
          className="zx-control"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={TITULO_MAX}
          required
          placeholder="ej. ¿Cómo manejan las devoluciones de Flex?"
        />
      </Campo>
      <Campo etiqueta="Cuéntanos más">
        <textarea
          className="zx-control"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          maxLength={CUERPO_MAX}
          rows={5}
          required
          placeholder="Explica tu caso con el detalle que ayude a otros a responderte."
        />
      </Campo>
      <AdjuntarImagen url={imagenUrl} onCambio={setImagenUrl} onSubiendo={setSubiendoImagen} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={enviando || subiendoImagen}>
          {enviando ? "Publicando…" : "Publicar pregunta"}
        </Boton>
        <span className={styles.contador}>
          {cuerpo.length}/{CUERPO_MAX}
        </span>
      </div>
    </form>
  );
}
