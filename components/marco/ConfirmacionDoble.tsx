"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Boton, clasesBoton } from "./Boton";
import styles from "./ConfirmacionDoble.module.css";

type Props = {
  // Texto del botón que abre el diálogo (ej. «Eliminar», «Desconectar»).
  textoDisparador: string;
  titulo: string;
  // Qué pasará al continuar.
  descripcion: React.ReactNode;
  // Nombre exacto que el usuario debe escribir en el paso 2.
  nombreEsperado: string;
  // Texto del botón rojo final (ej. «Eliminar definitivamente»).
  textoConfirmar: string;
  // Solo se llama tras el paso 2 con el nombre exacto.
  onConfirmar: () => void | Promise<void>;
  deshabilitado?: boolean;
};

// Doble confirmación para acciones destructivas (auditoría punto 6):
// paso 1 explica qué pasará; paso 2 pide escribir el nombre exacto.
// Nada llega al servidor hasta el paso 2.
export function ConfirmacionDoble({ textoDisparador, titulo, descripcion, nombreEsperado, textoConfirmar, onConfirmar, deshabilitado }: Props) {
  const [paso, setPaso] = useState<0 | 1 | 2>(0);
  const [escrito, setEscrito] = useState("");
  const [enviando, setEnviando] = useState(false);
  const idTitulo = useId();
  const disparador = useRef<HTMLButtonElement>(null);
  const cuadro = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  function cerrar() {
    setPaso(0);
    setEscrito("");
  }

  // Foco al abrir y en cada paso; al cerrar vuelve al disparador.
  useEffect(() => {
    if (paso === 1) cuadro.current?.querySelector<HTMLElement>("button")?.focus();
    if (paso === 2) campo.current?.focus();
  }, [paso]);
  const estabaAbierto = useRef(false);
  useEffect(() => {
    if (paso === 0 && estabaAbierto.current) disparador.current?.focus();
    estabaAbierto.current = paso !== 0;
  }, [paso]);

  useEffect(() => {
    if (paso === 0) return;
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") cerrar();
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [paso]);

  const coincide = escrito === nombreEsperado;

  async function confirmar() {
    if (!coincide || enviando) return;
    setEnviando(true);
    try {
      await onConfirmar();
    } finally {
      setEnviando(false);
      cerrar();
    }
  }

  return (
    <>
      <button ref={disparador} type="button" className={clasesBoton("peligro")} disabled={deshabilitado} onClick={() => setPaso(1)}>
        {textoDisparador}
      </button>
      {paso !== 0 && (
        <div className={styles.fondo} onClick={cerrar}>
          <div ref={cuadro} role="dialog" aria-modal="true" aria-labelledby={idTitulo} className={styles.cuadro} onClick={(e) => e.stopPropagation()}>
            <h2 id={idTitulo} className={styles.titulo}>
              {titulo}
            </h2>
            {paso === 1 ? (
              <>
                <p className={styles.texto}>{descripcion}</p>
                <div className={styles.acciones}>
                  <Boton type="button" variante="secundario" onClick={cerrar}>
                    Cancelar
                  </Boton>
                  <Boton type="button" variante="primario" onClick={() => setPaso(2)}>
                    Continuar
                  </Boton>
                </div>
              </>
            ) : (
              <>
                <label className={styles.texto}>
                  Para confirmar, escribe exactamente: <strong>{nombreEsperado}</strong>
                  <input ref={campo} className={`zx-control ${styles.campo}`} value={escrito} onChange={(e) => setEscrito(e.target.value)} autoComplete="off" />
                </label>
                <div className={styles.acciones}>
                  <Boton type="button" variante="secundario" onClick={cerrar}>
                    Cancelar
                  </Boton>
                  <Boton type="button" variante="peligro" disabled={!coincide || enviando} onClick={confirmar}>
                    {textoConfirmar}
                  </Boton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
