"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import styles from "./ModalInventario.module.css";

const LADO_VISTA_PREVIA = 240;
const SEPARACION = 10;

// Issue #280 — miniatura de /panel/inventario que muestra una vista de
// ~240px al pasar el mouse, al enfocarla con teclado o con el primer
// toque en pantalla táctil (el segundo toque, o el clic, abre el modal
// grande de FotoConZoom). Envuelve a FotoConZoom SIN cambiarlo:
// Despachos sigue con solo clic (un hover flotante ya lo rompió en
// staging). Posición fija + portal: la tabla tiene overflow y
// recortaría un absolute.
export function FotoInventario({ src, srcAmpliada, alt, claseMiniatura }: { src: string; srcAmpliada: string; alt: string; claseMiniatura?: string }) {
  const envolturaRef = useRef<HTMLSpanElement>(null);
  const ultimoPunteroRef = useRef<string>("mouse");
  // Si la vista ya estaba abierta ANTES del toque (el foco del tap la
  // abre antes del click, así que no basta mirar el estado al hacer clic).
  const abiertaAlTocarRef = useRef(false);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);

  function abrir() {
    const caja = envolturaRef.current?.getBoundingClientRect();
    if (!caja) return;
    // A la derecha de la miniatura; si no cabe, a la izquierda. Siempre
    // dentro de la ventana.
    let left = caja.right + SEPARACION;
    if (left + LADO_VISTA_PREVIA > window.innerWidth - 8) left = Math.max(8, caja.left - SEPARACION - LADO_VISTA_PREVIA);
    const top = Math.min(Math.max(8, caja.top + caja.height / 2 - LADO_VISTA_PREVIA / 2), window.innerHeight - LADO_VISTA_PREVIA - 8);
    setPosicion({ top, left });
  }
  const cerrar = () => setPosicion(null);
  // Los eventos del modal de FotoConZoom (portal) también suben por el
  // árbol de React hasta acá: solo cuentan los de la miniatura real.
  const esDeLaMiniatura = (e: React.SyntheticEvent) => e.currentTarget.contains(e.target as Node);

  useEffect(() => {
    if (!posicion) return;
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape") setPosicion(null);
    }
    // Al hacer scroll la miniatura se mueve: la vista previa se cierra
    // en vez de quedar flotando en otro lado.
    window.addEventListener("scroll", cerrar, true);
    document.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [posicion]);

  return (
    <span
      ref={envolturaRef}
      className={styles.envolturaFoto}
      onPointerDown={(e) => {
        if (!esDeLaMiniatura(e)) return;
        ultimoPunteroRef.current = e.pointerType;
        abiertaAlTocarRef.current = posicion !== null;
      }}
      onMouseEnter={(e) => esDeLaMiniatura(e) && abrir()}
      onMouseLeave={cerrar}
      onFocus={(e) => esDeLaMiniatura(e) && abrir()}
      onBlur={cerrar}
      // Táctil: el primer toque solo muestra la vista previa (no llega
      // al botón de FotoConZoom); con la vista abierta, el toque sigue
      // y abre el modal grande.
      onClickCapture={(e) => {
        if (!esDeLaMiniatura(e)) return;
        if (ultimoPunteroRef.current === "touch" && !abiertaAlTocarRef.current) {
          e.preventDefault();
          e.stopPropagation();
          abrir();
        } else {
          cerrar();
        }
      }}
    >
      <FotoConZoom src={src} srcAmpliada={srcAmpliada} alt={alt} claseMiniatura={claseMiniatura} />
      {posicion &&
        createPortal(
          <div className={styles.vistaPrevia} style={{ top: posicion.top, left: posicion.left }} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto externa de Mercado Libre, no un asset propio. */}
            <img src={srcAmpliada} alt="" />
          </div>,
          document.body
        )}
    </span>
  );
}
