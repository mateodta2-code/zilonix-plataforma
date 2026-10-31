"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tarjeta } from "./Tarjeta";
import styles from "./FotoConZoom.module.css";

export type FotoConZoomProps = {
  src: string;
  alt: string;
  // Clase de la miniatura (tamaño/recorte) — la decide quien use este
  // componente; FotoConZoom solo agrega el disparador y el modal.
  claseMiniatura?: string;
};

// Issue "zoom de despachos" (fix-despachos-zoom-fechas → fix-despachos-zoom-modal)
// — bug real reportado por Mateo en staging DOS veces: el popover
// flotante (primero por CSS :hover/:focus-within puro, después por
// estado de React) se quedaba pegado encima del título/precio/datos
// de la tarjeta. Cambio de enfoque pedido explícito: nada de posición
// absoluta sobre la tarjeta — un modal centrado, con portal a
// document.body (así ningún overflow/stacking-context de una tarjeta
// ancestra lo recorta ni lo tapa). Componente único y reutilizable:
// hoy solo lo usa TarjetaDespachoCliente (Pendientes y Despachados
// comparten ese mismo componente), pero cualquier otra pantalla con
// una miniatura de pedido_items lo puede reusar sin duplicar esto.
export function FotoConZoom({ src, alt, claseMiniatura }: FotoConZoomProps) {
  const [abierta, setAbierta] = useState(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierta) return;
    // Bloquea el scroll de fondo mientras está abierto — se restaura
    // al valor de ANTES (nunca forzado a ""), por si algo más en la
    // página ya le había puesto un overflow propio.
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    function cerrarConEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAbierta(false);
    }
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowPrevio;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [abierta]);

  return (
    <>
      {/* Punto 4 de la tarea: sin hover — solo clic/tap abre el modal. */}
      <button type="button" className={styles.disparador} onClick={() => setAbierta(true)} aria-label={`Ver foto ampliada: ${alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura externa de Mercado Libre, no un asset propio del proyecto. */}
        <img src={src} alt={alt} className={claseMiniatura} />
      </button>

      {abierta &&
        createPortal(
          <div
            className={styles.fondo}
            // Solo cierra si el click fue en el fondo mismo, nunca si
            // empezó/terminó adentro del marco (un click que arrastra
            // selección de texto y suelta afuera del marco no cuenta).
            onClick={(evento) => {
              if (evento.target === evento.currentTarget) setAbierta(false);
            }}
          >
            <div role="dialog" aria-modal="true" aria-label={`Foto: ${alt}`} className={styles.ventana}>
              <Tarjeta className={styles.marco}>
                <button type="button" ref={cerrarRef} className={styles.cerrar} onClick={() => setAbierta(false)} aria-label="Cerrar">
                  ×
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element -- misma foto, a tamaño completo dentro del modal */}
                <img src={src} alt={alt} className={styles.imagenGrande} />
              </Tarjeta>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
