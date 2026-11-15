"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import styles from "./page.module.css";

const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024;

// "Adjuntar imagen" del foro — sube el archivo a /api/foro/imagen apenas
// se elige (así la persona ve la vista previa antes de publicar) y le
// pasa la URL de Cloudinary al formulario. Solo archivo, nunca un link
// (decisión del 14-nov).
export function AdjuntarImagen({
  url,
  onCambio,
  onSubiendo,
}: {
  url: string | null;
  onCambio: (url: string | null) => void;
  onSubiendo: (subiendo: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function marcarSubiendo(valor: boolean) {
    setSubiendo(valor);
    onSubiendo(valor);
  }

  async function elegir(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!archivo) return;
    setError(null);
    // Mismo tope que el servidor — avisa antes de gastar la subida.
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      setError("La imagen pesa demasiado (máximo 8 MB).");
      return;
    }

    marcarSubiendo(true);
    try {
      const datos = new FormData();
      datos.set("archivo", archivo);
      const respuesta = await fetch("/api/foro/imagen", { method: "POST", body: datos });
      const cuerpo = (await respuesta.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!respuesta.ok || !cuerpo?.url) {
        setError(cuerpo?.error ?? "No se pudo subir la imagen. Vuelve a intentar.");
        return;
      }
      onCambio(cuerpo.url);
    } catch {
      setError("No se pudo subir la imagen. Revisa tu conexión y vuelve a intentar.");
    } finally {
      marcarSubiendo(false);
    }
  }

  return (
    <div className={styles.adjunto}>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={elegir} hidden aria-label="Elegir imagen" />
      {url ? (
        <div className={styles.vistaPrevia}>
          <img src={url} alt="Imagen adjunta" className={styles.miniatura} />
          <Boton type="button" variante="fantasma" chico onClick={() => onCambio(null)}>
            Quitar imagen
          </Boton>
        </div>
      ) : (
        <Boton type="button" variante="secundario" chico onClick={() => input.current?.click()} disabled={subiendo}>
          {subiendo ? "Subiendo imagen…" : "Adjuntar imagen"}
        </Boton>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
