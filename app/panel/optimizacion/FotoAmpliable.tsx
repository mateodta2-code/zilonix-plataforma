"use client";

import { useEffect, useState } from "react";
import { fotoGrande } from "@/lib/optimizacion/competidoresExtension";
import styles from "./page.module.css";

// Miniatura que se agranda al pasar el mouse (vista previa) y se abre
// grande al hacer clic (Esc o clic afuera la cierra). La vista previa va
// en una capa fija (position: fixed) para que la tabla con scroll no la
// recorte. La versión grande es la misma foto en tamaño original; si
// Mercado Libre no la tiene, se usa la miniatura.
export function FotoAmpliable({ src, alt, ancho = 40 }: { src: string | null; alt: string; ancho?: number }) {
  const [vista, setVista] = useState<{ x: number; y: number } | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [usarOriginal, setUsarOriginal] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [abierta]);

  if (!src) return <span className={styles.foto} />;
  const grande = usarOriginal ? src : fotoGrande(src);

  function mostrarVista(e: React.MouseEvent<HTMLButtonElement>) {
    const caja = e.currentTarget.getBoundingClientRect();
    const lado = 280;
    const x = Math.min(Math.max(8, caja.right + 12), Math.max(8, window.innerWidth - lado - 8));
    const y = Math.min(Math.max(8, caja.top - 40), Math.max(8, window.innerHeight - lado - 8));
    setVista({ x, y });
  }

  return (
    <>
      <button
        type="button"
        className={styles.fotoBoton}
        onMouseEnter={mostrarVista}
        onMouseLeave={() => setVista(null)}
        onFocus={() => setVista(null)}
        onClick={() => {
          setVista(null);
          setAbierta(true);
        }}
        aria-label={`Ampliar foto: ${alt}`}
      >
        <img className={styles.foto} src={src} alt="" width={ancho} height={ancho} loading="lazy" />
      </button>
      {vista && !abierta ? (
        <div className={styles.fotoVista} style={{ left: vista.x, top: vista.y }} aria-hidden="true">
          <img src={grande} alt="" onError={() => setUsarOriginal(true)} />
        </div>
      ) : null}
      {abierta ? (
        <div className={styles.fotoVisor} role="dialog" aria-modal="true" aria-label={alt} onClick={() => setAbierta(false)}>
          <img src={grande} alt={alt} onError={() => setUsarOriginal(true)} />
          <button type="button" className={styles.fotoCerrar} onClick={() => setAbierta(false)} aria-label="Cerrar foto">
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
