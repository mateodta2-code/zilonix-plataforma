"use client";

import { useState } from "react";
import { moverFoto } from "./formulario-logica";
import styles from "./publicar.module.css";

// Punto 4 del pedido — "Galería en miniaturas: la primera con etiqueta
// 'portada', botón quitar (x) por foto, reordenar arrastrando (drag &
// drop nativo, sin librería nueva), tarjeta '+' para agregar URL." La
// subida real a Cloudinary queda para la Parte 4 — por ahora, igual
// que antes, cada foto es una URL externa puesta a mano; `moverFoto`
// (formulario-logica.ts, con sus propias pruebas) hace el reordenado
// real, acá solo se conectan los eventos nativos de drag & drop
// (draggable + onDragStart/onDragOver/onDrop) — sin ninguna librería
// nueva, como pidió Mateo. ADENDO de diseño — cada miniatura y la
// tarjeta "+" llevan el anillo de marca (.recuadroMarca,
// publicar.module.css), igual que el resto de la página.
export function GaleriaFotos({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
  const [agregando, setAgregando] = useState(false);
  const [urlNueva, setUrlNueva] = useState("");
  const [indiceArrastrado, setIndiceArrastrado] = useState<number | null>(null);
  const [fotoRota, setFotoRota] = useState<Record<number, boolean>>({});

  function confirmarAgregar() {
    const limpia = urlNueva.trim();
    if (limpia) onChange([...urls, limpia]);
    setUrlNueva("");
    setAgregando(false);
  }

  function quitar(i: number) {
    onChange(urls.filter((_, idx) => idx !== i));
  }

  function alSoltar(indiceDestino: number) {
    if (indiceArrastrado == null) return;
    onChange(moverFoto(urls, indiceArrastrado, indiceDestino));
    setIndiceArrastrado(null);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
      {urls.map((url, i) => (
        <div
          key={`${url}-${i}`}
          draggable
          onDragStart={() => setIndiceArrastrado(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            alSoltar(i);
          }}
          className={`${styles.recuadroMarca} ${styles.miniatura}`}
          title={url}
        >
          {fotoRota[i] ? (
            <div className={styles.miniaturaRota}>sin vista previa</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa puesta a mano, sin optimizar con next/image
            <img src={url} alt="" className={styles.miniaturaImg} onError={() => setFotoRota((actual) => ({ ...actual, [i]: true }))} />
          )}
          {i === 0 && <span className={styles.etiquetaPortada}>portada</span>}
          <button type="button" onClick={() => quitar(i)} className={styles.botonQuitar} aria-label="Quitar foto">
            ×
          </button>
        </div>
      ))}

      {agregando ? (
        <div className={`${styles.recuadroMarca} ${styles.miniatura}`} style={{ cursor: "default", display: "flex", flexDirection: "column", padding: 4, gap: 4 }}>
          <input
            autoFocus
            value={urlNueva}
            onChange={(e) => setUrlNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarAgregar();
              if (e.key === "Escape") {
                setAgregando(false);
                setUrlNueva("");
              }
            }}
            placeholder="https://…"
            className="zx-control"
            style={{ fontSize: 10, padding: 3 }}
          />
          <button type="button" onClick={confirmarAgregar} style={{ fontSize: 10, padding: "2px 4px", cursor: "pointer" }}>
            Agregar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAgregando(true)} className={`${styles.recuadroMarca} ${styles.tarjetaAgregar}`} aria-label="Agregar foto">
          +
        </button>
      )}
    </div>
  );
}
