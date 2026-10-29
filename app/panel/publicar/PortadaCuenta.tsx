"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { usarSubidaFotoCloudinary } from "./usarSubidaFotoCloudinary";
import styles from "./publicar.module.css";

// Rama feat-publicar-fotos-zip — también admite .zip (ver el
// comentario completo en GaleriaFotos.tsx); acá solo se toma la
// PRIMERA imagen del ZIP para la portada (ver procesarArchivos,
// usarSubidaFotoCloudinary.ts) — nunca un error, solo un aviso.
const TIPOS_IMAGEN_ACEPTADOS = "image/jpeg,image/png,image/webp,.zip,application/zip,application/x-zip-compressed";

// Punto 3 del feedback de Mateo (staging) — se quitó el campo "URL de
// la foto de portada en <cuenta>": el cuadrito de portada de cada
// cuenta ahora funciona con el MISMO patrón que la galería general
// (GaleriaFotos.tsx, mismo hook usarSubidaFotoCloudinary): clic abre
// el selector de archivos de la PC, arrastrar y soltar también
// funciona, y debajo hay un campo chico "Link de Canva" + "Traer".
// Cuando la cuenta todavía no tiene portada PROPIA, se muestra la
// primera foto de la galería general como vista previa, atenuada
// (nunca a plena opacidad — para que se note que es solo una
// referencia, no la portada real ya elegida para esta cuenta en
// particular) y `onChange` nunca se dispara solo por mostrarla.
export function PortadaCuenta({
  portadaUrl,
  onChange,
  cloudinaryConfigurado,
  previaGaleria,
}: {
  portadaUrl: string;
  onChange: (url: string) => void;
  cloudinaryConfigurado: boolean;
  previaGaleria: string | null;
}) {
  const [agregandoUrlManual, setAgregandoUrlManual] = useState(false);
  const [urlNueva, setUrlNueva] = useState("");
  const [canvaUrl, setCanvaUrl] = useState("");
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const { subiendo, error, aviso, progreso, subirCanvaUrl, procesarArchivos } = usarSubidaFotoCloudinary(onChange);

  function alHacerClic() {
    if (subiendo) return;
    if (cloudinaryConfigurado) inputArchivoRef.current?.click();
    else setAgregandoUrlManual(true);
  }

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    // `true` = soloUna — la portada de una cuenta es UNA sola foto;
    // si llega un ZIP con varias (o varios archivos sueltos a la vez),
    // se toma solo la primera (orden natural) y se avisa, nunca error.
    if (archivos.length) void procesarArchivos(archivos, true);
  }

  function alSoltar(e: React.DragEvent) {
    e.preventDefault();
    const archivos = Array.from(e.dataTransfer.files ?? []);
    if (archivos.length) void procesarArchivos(archivos, true);
  }

  function confirmarUrlManual() {
    const limpia = urlNueva.trim();
    if (limpia) onChange(limpia);
    setUrlNueva("");
    setAgregandoUrlManual(false);
  }

  function confirmarCanvaUrl() {
    const limpia = canvaUrl.trim();
    if (!limpia) return;
    subirCanvaUrl(limpia, () => setCanvaUrl(""));
  }

  const imagenAMostrar = portadaUrl || previaGaleria;
  const esSoloVistaPrevia = !portadaUrl && Boolean(previaGaleria);

  return (
    <div style={{ width: 90, flexShrink: 0 }}>
      {agregandoUrlManual ? (
        <div className={`${styles.recuadroMarca} ${styles.portadaChica}`} style={{ padding: 4, display: "flex", flexDirection: "column", gap: 4, cursor: "default" }}>
          <input
            autoFocus
            value={urlNueva}
            onChange={(e) => setUrlNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarUrlManual();
              if (e.key === "Escape") {
                setAgregandoUrlManual(false);
                setUrlNueva("");
              }
            }}
            placeholder="https://…"
            className="zx-control"
            style={{ fontSize: 9, padding: 2 }}
          />
          <Boton type="button" variante="secundario" chico onClick={confirmarUrlManual} style={{ fontSize: 9, padding: "2px 3px" }}>
            Agregar
          </Boton>
        </div>
      ) : (
        <button
          type="button"
          onClick={alHacerClic}
          onDragOver={(e) => e.preventDefault()}
          onDrop={alSoltar}
          disabled={subiendo}
          aria-label={cloudinaryConfigurado ? "Subir portada desde la PC" : "Agregar portada"}
          className={`${styles.recuadroMarca} ${styles.portadaChica}`}
          style={{ position: "relative", padding: 0, borderStyle: imagenAMostrar ? undefined : "dashed", cursor: "pointer", display: "block" }}
        >
          {imagenAMostrar ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa/Cloudinary, sin optimizar con next/image
            <img src={imagenAMostrar} alt="" className={styles.portadaChicaImg} style={esSoloVistaPrevia ? { opacity: 0.45 } : undefined} />
          ) : null}
          {progreso ? (
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, textAlign: "center" }}>
              {progreso.actual}/{progreso.total}
            </span>
          ) : subiendo ? (
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>Subiendo…</span>
          ) : !imagenAMostrar ? (
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>+</span>
          ) : null}
        </button>
      )}
      <input ref={inputArchivoRef} type="file" accept={TIPOS_IMAGEN_ACEPTADOS} multiple onChange={alElegirArchivo} hidden />

      {cloudinaryConfigurado && (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
          <input
            value={canvaUrl}
            onChange={(e) => setCanvaUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarCanvaUrl();
            }}
            placeholder="Link de Canva"
            className="zx-control"
            style={{ fontSize: 9, padding: 2, width: "100%" }}
            disabled={subiendo}
          />
          <Boton type="button" variante="secundario" chico onClick={confirmarCanvaUrl} disabled={subiendo || !canvaUrl.trim()} style={{ fontSize: 9, padding: "2px 3px" }}>
            Traer
          </Boton>
        </div>
      )}
      {aviso && <p style={{ fontSize: 9, color: "var(--texto-suave)", marginTop: 3 }}>{aviso}</p>}
      {error && <p style={{ fontSize: 9, color: "var(--kpi-peligro-texto)", marginTop: 3 }}>{error}</p>}
    </div>
  );
}
