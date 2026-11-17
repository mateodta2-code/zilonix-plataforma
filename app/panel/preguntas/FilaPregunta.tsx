"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { linkPublicacion } from "@/lib/ml/permalink";
import { formatearMoneda } from "@/lib/ml/sitios";
import { minutosDesde, textoEspera, tonoEspera } from "@/lib/preguntas/tiempo";
import { responderPreguntaAction } from "./actions";
import styles from "./page.module.css";

export type PreguntaFila = {
  id: string;
  cuentaMlId: string;
  nickname: string;
  siteId: string | null;
  texto: string;
  itemId: string | null;
  fecha: string | null;
  titulo: string | null;
  precio: string | null;
  stock: number | null;
};

const LARGO_MAXIMO = 2000;

// Una pregunta: se lee, se escribe la respuesta y Enter la manda
// (Shift+Enter hace salto de línea). Al enviarse, la página se vuelve a
// pedir y la pregunta sale de la lista.
export function FilaPregunta({ pregunta, puedeResponder, ahoraMs }: { pregunta: PreguntaFila; puedeResponder: boolean; ahoraMs: number }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const minutos = minutosDesde(pregunta.fecha, new Date(ahoraMs));
  const enlace = pregunta.itemId ? linkPublicacion(pregunta.itemId) : null;
  const precio = pregunta.precio !== null && Number.isFinite(Number(pregunta.precio)) ? formatearMoneda(Number(pregunta.precio), pregunta.siteId) : null;

  function enviar() {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    iniciar(async () => {
      const resultado = await responderPreguntaAction({ cuentaMlId: pregunta.cuentaMlId, preguntaId: pregunta.id, texto: limpio });
      setAviso({ ok: resultado.ok, texto: resultado.aviso });
      if (resultado.ok) {
        setTexto("");
        router.refresh();
      }
    });
  }

  return (
    <li className={styles.pregunta}>
      <div className={styles.cabeceraPregunta}>
        <Chip estado={tonoEspera(minutos)}>{textoEspera(minutos)}</Chip>
        <span className={styles.cuenta}>{pregunta.nickname}</span>
      </div>

      <p className={styles.producto}>
        {enlace ? (
          <a href={enlace} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
            {pregunta.titulo ?? pregunta.itemId}
          </a>
        ) : (
          (pregunta.titulo ?? pregunta.itemId ?? "Publicación")
        )}
        {precio ? <span className={styles.dato}> · {precio}</span> : null}
        {pregunta.stock !== null ? <span className={styles.dato}> · {pregunta.stock > 0 ? `${pregunta.stock} en stock` : "sin stock"}</span> : null}
      </p>

      {/* Texto del comprador: React lo escapa; se muestra, nunca se ejecuta. */}
      <p className={styles.textoPregunta}>{pregunta.texto.slice(0, LARGO_MAXIMO)}</p>

      {puedeResponder ? (
        <form
          className={styles.formRespuesta}
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <textarea
            className="zx-control"
            rows={2}
            maxLength={LARGO_MAXIMO}
            placeholder="Escribe la respuesta y presiona Enter"
            value={texto}
            disabled={enviando}
            aria-label={`Respuesta a la pregunta de ${pregunta.nickname}`}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
          />
          <Boton type="submit" chico disabled={enviando || !texto.trim()}>
            {enviando ? "Enviando…" : "Responder"}
          </Boton>
        </form>
      ) : (
        <p className={styles.nota}>Tu rol puede ver las preguntas, pero no responderlas.</p>
      )}
      {aviso ? (
        <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
          {aviso.texto}
        </p>
      ) : null}
    </li>
  );
}
