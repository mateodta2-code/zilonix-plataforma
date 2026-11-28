"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./ModalInventario.module.css";

// Issue #280 — ventana emergente común de /panel/inventario (Modificar
// e Historial del producto). Mismo comportamiento que FotoConZoom:
// portal a document.body, Cerrar arriba a la derecha, Escape y clic en
// el fondo cierran, scroll de fondo bloqueado mientras está abierta.
export function ModalInventario({
  titulo,
  subtitulo,
  icono,
  onCerrar,
  children,
}: {
  titulo: string;
  subtitulo: string;
  icono?: React.ReactNode;
  onCerrar: () => void;
  children: React.ReactNode;
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null);
  // onCerrar cambia en cada render del padre: se lee por ref para no
  // volver a montar el listener (y no perder el foco) cada vez.
  const onCerrarRef = useRef(onCerrar);
  onCerrarRef.current = onCerrar;

  useEffect(() => {
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    function cerrarConEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") onCerrarRef.current();
    }
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowPrevio;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, []);

  return createPortal(
    <div
      className={styles.fondo}
      // Solo el fondo mismo cierra (un arrastre que suelta afuera no).
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) onCerrar();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={`${titulo}: ${subtitulo}`} className={styles.ventana}>
        <Tarjeta className={styles.marco}>
          <button type="button" ref={cerrarRef} className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
          <div className={styles.cabecera}>
            {icono}
            <div>
              <h2 className={styles.titulo}>{titulo}</h2>
              <p className={styles.subtitulo}>{subtitulo}</p>
            </div>
          </div>
          <div className={styles.cuerpo}>{children}</div>
        </Tarjeta>
      </div>
    </div>,
    document.body
  );
}
