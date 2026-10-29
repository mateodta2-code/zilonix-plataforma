"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { moverFoto } from "./formulario-logica";
import styles from "./publicar.module.css";

const TIPOS_IMAGEN_ACEPTADOS = "image/jpeg,image/png,image/webp";

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
export function GaleriaFotos({
  urls,
  onChange,
  cloudinaryConfigurado,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  // Parte 3, punto C — "si Cloudinary no está configurado: mensaje
  // claro, nunca romper el formulario". Resuelto en el servidor
  // (page.tsx, lib/cloudinary.ts) y bajado como prop simple — así el
  // aviso se ve ANTES de intentar subir nada (no solo después de un
  // 503), y la tarjeta "+" de URL manual (de siempre) sigue
  // funcionando igual, nunca se bloquea por esto.
  cloudinaryConfigurado: boolean;
}) {
  const [agregando, setAgregando] = useState(false);
  const [urlNueva, setUrlNueva] = useState("");
  const [indiceArrastrado, setIndiceArrastrado] = useState<number | null>(null);
  const [fotoRota, setFotoRota] = useState<Record<number, boolean>>({});

  // Parte 3, punto C — subida real a Cloudinary (archivo de la PC o
  // una URL de exportación de Canva, validada server-side en
  // app/api/ml/publicar/fotos/route.ts). `subiendo` deshabilita los 2
  // botones nuevos mientras hay una subida en curso — nunca 2 subidas
  // pisándose la respuesta una a la otra.
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [canvaUrl, setCanvaUrl] = useState("");
  const inputArchivoRef = useRef<HTMLInputElement>(null);

  function confirmarAgregar() {
    const limpia = urlNueva.trim();
    if (limpia) onChange([...urls, limpia]);
    setUrlNueva("");
    setAgregando(false);
  }

  async function subirACloudinaryDesdeGaleria(body: FormData) {
    setSubiendo(true);
    setErrorSubida(null);
    try {
      const resp = await fetch("/api/ml/publicar/fotos", { method: "POST", body });
      const data = (await resp.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!resp.ok || !data?.url) {
        setErrorSubida(data?.error ?? "No se pudo subir la imagen.");
        return;
      }
      onChange([...urls, data.url]);
    } catch {
      setErrorSubida("No se pudo subir la imagen — revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubiendo(false);
    }
  }

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite elegir el MISMO archivo dos veces seguidas
    if (!archivo) return;
    const form = new FormData();
    form.append("archivo", archivo);
    void subirACloudinaryDesdeGaleria(form);
  }

  function confirmarCanvaUrl() {
    const limpia = canvaUrl.trim();
    if (!limpia) return;
    const form = new FormData();
    form.append("canvaUrl", limpia);
    void subirACloudinaryDesdeGaleria(form).then(() => setCanvaUrl(""));
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
      const form = new FormData();
      form.append("archivo", archivo);
      void subirACloudinaryDesdeGaleria(form);
      return;
    }
    if (indiceArrastrado == null) return;
    onChange(moverFoto(urls, indiceArrastrado, indiceDestino));
    setIndiceArrastrado(null);
  }

  function alSoltarEnAgregar(e: React.DragEvent) {
    e.preventDefault();
    const archivo = e.dataTransfer.files?.[0];
    if (archivo) {
      const form = new FormData();
      form.append("archivo", archivo);
      void subirACloudinaryDesdeGaleria(form);
    }
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
            <Boton type="button" variante="secundario" chico onClick={confirmarAgregar} style={{ fontSize: 10, padding: "2px 4px" }}>
              Agregar
            </Boton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAgregando(true)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={alSoltarEnAgregar}
            className={`${styles.recuadroMarca} ${styles.tarjetaAgregar}`}
            aria-label="Agregar foto"
          >
            +
          </button>
        )}
      </div>

      {cloudinaryConfigurado ? (
        <>
          {/* Parte 3, punto C — subida real a Cloudinary: arrastrar/elegir
          un archivo de la PC, o pegar una URL de EXPORTACIÓN de Canva
          (nunca el link de "compartir" el diseño — ese es HTML detrás de
          login, no una imagen; validado server-side con una lista blanca
          de hosts). Las 2 suben signed a Cloudinary y agregan la
          secure_url real a la galería — nunca el link crudo de Canva como
          fuente final. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, alignItems: "center" }}>
            <input ref={inputArchivoRef} type="file" accept={TIPOS_IMAGEN_ACEPTADOS} onChange={alElegirArchivo} hidden />
            <Boton type="button" variante="secundario" chico onClick={() => inputArchivoRef.current?.click()} disabled={subiendo}>
              {subiendo ? "Subiendo…" : "Subir foto de la PC"}
            </Boton>
            <input
              value={canvaUrl}
              onChange={(e) => setCanvaUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarCanvaUrl();
              }}
              placeholder="URL de exportación de Canva (PNG/JPG)"
              className="zx-control"
              style={{ fontSize: 12, flex: "1 1 220px" }}
              disabled={subiendo}
            />
            <Boton type="button" variante="secundario" chico onClick={confirmarCanvaUrl} disabled={subiendo || !canvaUrl.trim()}>
              Traer de Canva
            </Boton>
          </div>
          {errorSubida && <p style={{ fontSize: 12, color: "var(--kpi-peligro-texto)", marginTop: 6 }}>{errorSubida}</p>}
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 10 }}>
          Subir foto de la PC / traer de Canva todavía no está disponible en este ambiente (falta configurar Cloudinary) — por ahora, usá la
          tarjeta "+" para agregar una foto por URL.
        </p>
      )}
    </div>
  );
}
