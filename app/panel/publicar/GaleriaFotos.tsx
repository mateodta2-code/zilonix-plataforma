"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { moverFoto } from "./formulario-logica";
import { usarSubidaFotoCloudinary } from "./usarSubidaFotoCloudinary";
import styles from "./publicar.module.css";

const TIPOS_IMAGEN_ACEPTADOS = "image/jpeg,image/png,image/webp";

// Feedback real de Mateo probando en staging — la tarjeta "+" dejó de
// ser "escribir una URL a mano" y pasó a ser "subir un archivo de la
// PC" (clic abre el selector de archivos; arrastrar y soltar también
// funciona, igual que antes). El campo de URL manual + botón "Agregar"
// que vivían DENTRO de la tarjeta se sacaron de acá — el único camino
// que queda para pegar un link a mano es el campo chico de Canva, más
// abajo (que sube signed a Cloudinary, nunca sirve el link crudo).
//
// Única excepción, a propósito: si Cloudinary NO está configurado en
// este ambiente (`cloudinaryConfigurado=false`), subir un archivo
// fallaría siempre (503, ver app/api/ml/publicar/fotos/route.ts) — la
// tarjeta "+" vuelve al modo anterior (URL manual) en ese caso
// puntual, para no romper el único camino que YA existía ("si
// Cloudinary no está configurado: seguir permitiendo URL manual",
// Parte 3 punto C). Con Cloudinary configurado (el caso real de
// staging/producción) esto nunca se ve.
export function GaleriaFotos({
  urls,
  onChange,
  cloudinaryConfigurado,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  cloudinaryConfigurado: boolean;
}) {
  const [agregandoUrlManual, setAgregandoUrlManual] = useState(false);
  const [urlNueva, setUrlNueva] = useState("");
  const [indiceArrastrado, setIndiceArrastrado] = useState<number | null>(null);
  const [fotoRota, setFotoRota] = useState<Record<number, boolean>>({});

  const [canvaUrl, setCanvaUrl] = useState("");
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const { subiendo, error: errorSubida, subirArchivo, subirCanvaUrl } = usarSubidaFotoCloudinary((url) => onChange([...urls, url]));

  function confirmarAgregarUrlManual() {
    const limpia = urlNueva.trim();
    if (limpia) onChange([...urls, limpia]);
    setUrlNueva("");
    setAgregandoUrlManual(false);
  }

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite elegir el MISMO archivo dos veces seguidas
    if (archivo) subirArchivo(archivo);
  }

  function confirmarCanvaUrl() {
    const limpia = canvaUrl.trim();
    if (!limpia) return;
    subirCanvaUrl(limpia, () => setCanvaUrl(""));
  }

  function quitar(i: number) {
    onChange(urls.filter((_, idx) => idx !== i));
  }

  // Un drop puede ser 2 cosas bien distintas: reordenar una miniatura
  // que YA está en la galería (arrastrada desde otra miniatura de acá
  // mismo, sin ningún `File` real adentro de dataTransfer) o soltar un
  // archivo real desde el escritorio/explorador (dataTransfer.files
  // con contenido) — se mira `files` primero para no confundir una
  // cosa con la otra.
  function alSoltar(e: React.DragEvent, indiceDestino: number) {
    e.preventDefault();
    const archivo = e.dataTransfer.files?.[0];
    if (archivo) {
      subirArchivo(archivo);
      return;
    }
    if (indiceArrastrado == null) return;
    onChange(moverFoto(urls, indiceArrastrado, indiceDestino));
    setIndiceArrastrado(null);
  }

  function alSoltarEnAgregar(e: React.DragEvent) {
    e.preventDefault();
    const archivo = e.dataTransfer.files?.[0];
    if (archivo) subirArchivo(archivo);
  }

  function alHacerClicEnAgregar() {
    if (subiendo) return;
    if (cloudinaryConfigurado) inputArchivoRef.current?.click();
    else setAgregandoUrlManual(true);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {urls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            draggable
            onDragStart={() => setIndiceArrastrado(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => alSoltar(e, i)}
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

        <input ref={inputArchivoRef} type="file" accept={TIPOS_IMAGEN_ACEPTADOS} onChange={alElegirArchivo} hidden />

        {agregandoUrlManual ? (
          <div className={`${styles.recuadroMarca} ${styles.miniatura}`} style={{ cursor: "default", display: "flex", flexDirection: "column", padding: 4, gap: 4 }}>
            <input
              autoFocus
              value={urlNueva}
              onChange={(e) => setUrlNueva(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarAgregarUrlManual();
                if (e.key === "Escape") {
                  setAgregandoUrlManual(false);
                  setUrlNueva("");
                }
              }}
              placeholder="https://…"
              className="zx-control"
              style={{ fontSize: 10, padding: 3 }}
            />
            <Boton type="button" variante="secundario" chico onClick={confirmarAgregarUrlManual} style={{ fontSize: 10, padding: "2px 4px" }}>
              Agregar
            </Boton>
          </div>
        ) : (
          <button
            type="button"
            onClick={alHacerClicEnAgregar}
            onDragOver={(e) => e.preventDefault()}
            onDrop={alSoltarEnAgregar}
            className={`${styles.recuadroMarca} ${styles.tarjetaAgregar}`}
            disabled={subiendo}
            aria-label={cloudinaryConfigurado ? "Subir foto desde la PC" : "Agregar foto"}
          >
            {subiendo ? <span style={{ fontSize: 11 }}>Subiendo…</span> : "+"}
          </button>
        )}
      </div>

      {cloudinaryConfigurado ? (
        <>
          {/* Punto C — campo chico para traer una exportación de Canva
          (nunca el link de "compartir" el diseño — ese es HTML detrás
          de login, no una imagen; validado server-side con una lista
          blanca de hosts + anti-SSRF + magic bytes). Ancho moderado a
          propósito (nunca ocupa todo el ancho de la tarjeta) — es un
          campo secundario, el camino principal es la tarjeta "+". */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <input
              value={canvaUrl}
              onChange={(e) => setCanvaUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarCanvaUrl();
              }}
              placeholder="Link de Canva"
              className="zx-control"
              style={{ fontSize: 12, width: 220 }}
              disabled={subiendo}
            />
            <Boton type="button" variante="secundario" chico onClick={confirmarCanvaUrl} disabled={subiendo || !canvaUrl.trim()}>
              Traer
            </Boton>
          </div>
          {errorSubida && <p style={{ fontSize: 12, color: "var(--kpi-peligro-texto)", marginTop: 6 }}>{errorSubida}</p>}
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 10 }}>
          Subir desde la PC / traer de Canva todavía no está disponible en este ambiente (falta configurar Cloudinary) — por ahora, la tarjeta
          "+" agrega una foto por URL.
        </p>
      )}
    </div>
  );
}
