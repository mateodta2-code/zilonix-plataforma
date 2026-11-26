"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { reducirImagen } from "@/lib/imagenes/reducirImagen";
import { CALIDAD_CAPTURA, LADO_MAXIMO_CAPTURA, MAX_IMAGENES_TICKET } from "@/lib/soporte/imagenes";
import styles from "./Capturas.module.css";

// Tickets de soporte (25-nov): adjuntar hasta 3 capturas por mensaje. Se
// reducen en el navegador a JPEG antes de enviarlas; el formulario las
// manda en un FormData (campo «imagen»). Se pueden quitar antes de enviar.
export function AdjuntarCapturas({ imagenes, onChange, deshabilitado }: { imagenes: Blob[]; onChange: (imagenes: Blob[]) => void; deshabilitado?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const urls = useMemo(() => imagenes.map((b) => URL.createObjectURL(b)), [imagenes]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (archivos.length === 0) return;
    setError(null);
    const libres = MAX_IMAGENES_TICKET - imagenes.length;
    if (archivos.length > libres) setError(`Puedes adjuntar hasta ${MAX_IMAGENES_TICKET} imágenes por mensaje.`);
    setProcesando(true);
    const reducidas: Blob[] = [];
    for (const archivo of archivos.slice(0, Math.max(0, libres))) {
      const r = await reducirImagen(archivo, LADO_MAXIMO_CAPTURA, CALIDAD_CAPTURA);
      if (r) reducidas.push(r);
      else setError("No se pudo leer una de las imágenes. Prueba con otra (JPG o PNG).");
    }
    setProcesando(false);
    if (reducidas.length > 0) onChange([...imagenes, ...reducidas]);
  }

  return (
    <div className={styles.adjuntar}>
      <input ref={input} type="file" accept="image/*" multiple onChange={elegir} hidden aria-label="Elegir imágenes" />
      <div className={styles.fila}>
        {urls.map((u, i) => (
          <div key={u} className={styles.miniatura}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob local, no pasa por next/image */}
            <img src={u} alt={`Imagen adjunta ${i + 1}`} />
            <button type="button" className={styles.quitar} onClick={() => onChange(imagenes.filter((_, j) => j !== i))} aria-label={`Quitar imagen ${i + 1}`} disabled={deshabilitado}>
              ✕
            </button>
          </div>
        ))}
        {imagenes.length < MAX_IMAGENES_TICKET && (
          <Boton type="button" variante="fantasma" onClick={() => input.current?.click()} disabled={deshabilitado || procesando}>
            {procesando ? "Preparando…" : "Adjuntar imágenes"}
          </Boton>
        )}
      </div>
      <p className={styles.nota}>Opcional: hasta {MAX_IMAGENES_TICKET} capturas que muestren el problema. Solo las ve tu empresa y el equipo de soporte de Zilonix.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}

export function aFormData(imagenes: Blob[]): FormData {
  const datos = new FormData();
  imagenes.forEach((b, i) => datos.append("imagen", b, `captura-${i + 1}.jpg`));
  return datos;
}
