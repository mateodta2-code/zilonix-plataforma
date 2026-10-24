"use client";

import { useRef } from "react";
import { Boton } from "@/components/marco/Boton";
import styles from "./PanelLateral.module.css";

// Issue #200 — Sharel: la tarjeta "Agregar producto, tienda o
// competidor" solo tenía un "?" chico (components/marco/Ayuda.tsx) —
// para una guía más larga, con secciones, un cliente necesita algo
// más grande y fácil de encontrar que un tooltip. <dialog> nativo:
// Escape para cerrar y el backdrop ya vienen gratis del navegador, sin
// ninguna librería ni manejo de foco a mano.
export function PanelLateral({ textoBoton, titulo, children }: { textoBoton: string; titulo: string; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Boton type="button" variante="secundario" chico onClick={() => dialogRef.current?.showModal()}>
        {textoBoton}
      </Boton>
      <dialog
        ref={dialogRef}
        className={styles.dialogo}
        onClick={(e) => {
          // target === currentTarget solo pasa clicando el backdrop en
          // sí (el <dialog>) — un clic adentro de .panel llega acá con
          // target = el elemento hijo real, nunca iguala al <dialog>.
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className={styles.panel}>
          <div className={styles.encabezado}>
            <p className={styles.titulo}>{titulo}</p>
            <button type="button" className={styles.botonCerrar} onClick={() => dialogRef.current?.close()} aria-label="Cerrar guía">
              ×
            </button>
          </div>
          <div className={styles.contenido}>{children}</div>
        </div>
      </dialog>
    </>
  );
}
