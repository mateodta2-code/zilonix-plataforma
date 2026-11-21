"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import {
  CALIDAD_JPEG,
  construirConsultas,
  MAX_ATRIBUTOS,
  MAX_BYTES_FOTO,
  MAX_LADO_PX,
  MAX_SEGUNDOS_VIDEO,
  MENSAJE_NO_RECONOCIDO,
  type Reconocimiento,
} from "@/lib/ml/buscarPorFoto";
import { guardarFotoBusqueda } from "@/lib/ml/fotoMemoria";
import { marcarClicAnalizar } from "./analizarClic";
import styles from "./page.module.css";

// «Buscar por foto» (primer corte: solo Mercado Libre). La persona sube,
// arrastra o pega una foto (o elige un cuadro de un video corto); el
// servidor la reconoce con la IA que la propia empresa conectó; aquí se
// muestra lo reconocido en campos editables y «Buscar» navega igual que
// FormularioAnalizar.alEnviar (marcarClicAnalizar + router.push), así que
// el arreglo de #227/#349 sigue intacto.
//
// PRIVACIDAD: la foto vive solo en memoria del navegador (variable del
// módulo en lib/ml/fotoMemoria.ts) — nunca sessionStorage ni localStorage.
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES_VIDEO = 200 * 1024 * 1024; // solo para no cargar un archivo absurdo en memoria

type Estado = "inicial" | "reconociendo" | "listo";

// Reduce a JPEG (lado mayor ≤ MAX_LADO_PX) — fondo blanco para PNG con transparencia.
async function reducirAJpeg(origen: Blob | HTMLVideoElement): Promise<Blob | null> {
  let ancho: number;
  let alto: number;
  let dibujable: CanvasImageSource;
  let liberar: (() => void) | null = null;
  if (origen instanceof Blob) {
    const bitmap = await createImageBitmap(origen);
    ancho = bitmap.width;
    alto = bitmap.height;
    dibujable = bitmap;
    liberar = () => bitmap.close();
  } else {
    ancho = origen.videoWidth;
    alto = origen.videoHeight;
    dibujable = origen;
  }
  if (!ancho || !alto) return null;
  const escala = Math.min(1, MAX_LADO_PX / Math.max(ancho, alto));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(ancho * escala));
  canvas.height = Math.max(1, Math.round(alto * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(dibujable, 0, 0, canvas.width, canvas.height);
  liberar?.();
  return new Promise((resolver) => canvas.toBlob((b) => resolver(b), "image/jpeg", CALIDAD_JPEG));
}

function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => rechazar(lector.error);
    lector.readAsDataURL(blob);
  });
}

// Validación previa al navegador (el servidor revalida por firma de bytes).
export function validarArchivoFoto(archivo: { type: string; size: number }): string | null {
  if (archivo.type.startsWith("video/")) {
    return archivo.size > MAX_BYTES_VIDEO ? "Ese video es demasiado grande. Sube un pantallazo del cuadro." : null;
  }
  if (!TIPOS_IMAGEN.includes(archivo.type)) return "Solo se aceptan fotos JPG, PNG o WebP.";
  if (archivo.size > MAX_BYTES_FOTO) return "La foto pesa más de 5 MB. Elige una más liviana.";
  return null;
}

export function BuscarPorFoto({ pais, tab = "demanda" }: { pais: string; tab?: string }) {
  const router = useRouter();
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fotoRef = useRef<string | null>(null); // base64 JPEG reducido, solo en memoria
  const [estado, setEstado] = useState<Estado>("inicial");
  const [error, setError] = useState<string | null>(null);
  const [miniatura, setMiniatura] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [confianzaBaja, setConfianzaBaja] = useState(false);
  const [yaBusco, setYaBusco] = useState(false);
  const [nombre, setNombre] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [atributos, setAtributos] = useState<string[]>([]);
  const [atributoNuevo, setAtributoNuevo] = useState("");
  const [consultas, setConsultas] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duracion, setDuracion] = useState(0);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Ctrl/Cmd+V con una imagen en el portapapeles.
  useEffect(() => {
    function alPegar(evento: ClipboardEvent) {
      const archivo = Array.from(evento.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!archivo) return; // texto u otra cosa: no se toca
      evento.preventDefault();
      void procesar(archivo);
    }
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- procesar solo usa setters y refs estables
  }, [pais]);

  async function procesar(archivo: File) {
    setError(null);
    const problema = validarArchivoFoto(archivo);
    if (problema) {
      setError(problema);
      return;
    }
    if (archivo.type.startsWith("video/")) {
      setVideoUrl(URL.createObjectURL(archivo));
      return;
    }
    await reconocer(archivo);
  }

  async function reconocer(fuente: Blob | HTMLVideoElement) {
    setEstado("reconociendo");
    setError(null);
    try {
      const jpeg = await reducirAJpeg(fuente);
      if (!jpeg || jpeg.size > MAX_BYTES_FOTO) throw new Error("No se pudo preparar la foto.");
      fotoRef.current = await aBase64(jpeg);
      setMiniatura(`data:image/jpeg;base64,${fotoRef.current}`);
      const form = new FormData();
      form.append("imagen", jpeg, "foto.jpg");
      form.append("pais", pais);
      const res = await fetch("/api/investigacion/buscar-por-foto", { method: "POST", body: form });
      const datos = (await res.json().catch(() => null)) as { error?: string; reconocimiento?: Reconocimiento; consultas?: string[]; confianzaBaja?: boolean } | null;
      if (!res.ok || !datos?.reconocimiento) {
        setError(datos?.error ?? MENSAJE_NO_RECONOCIDO);
        setEstado(nombre ? "listo" : "inicial");
        return;
      }
      const r = datos.reconocimiento;
      setNombre(r.nombre);
      setMarca(r.marca ?? "");
      setModelo(r.modelo ?? "");
      setAtributos(r.atributos);
      setConsultas(datos.consultas ?? r.consultas);
      setConfianzaBaja(datos.confianzaBaja === true);
      setYaBusco(false);
      setEstado("listo");
    } catch {
      setError("No se pudo leer la foto. Prueba con otra o escribe el nombre.");
      setEstado("inicial");
    }
  }

  function usarCuadroDeVideo() {
    if (videoRef.current) void reconocer(videoRef.current);
  }

  function alCargarVideo() {
    const d = videoRef.current?.duration ?? 0;
    if (d > MAX_SEGUNDOS_VIDEO) {
      setVideoUrl(null);
      setError(`El video dura más de ${MAX_SEGUNDOS_VIDEO} s. Para video, sube un pantallazo del cuadro.`);
      return;
    }
    setDuracion(d);
  }

  function buscar() {
    const armado = construirConsultas({ nombre, marca: marca.trim() || null, modelo: modelo.trim() || null, consultas, atributos });
    if (!armado.termino || !fotoRef.current) return;
    guardarFotoBusqueda({ termino: armado.termino, pais, base64: fotoRef.current });
    marcarClicAnalizar(pais, "ml", armado.consultas);
    setYaBusco(true);
    router.push(`/panel/investigacion?termino=${encodeURIComponent(armado.termino)}&tab=${tab}`);
  }

  function agregarAtributo() {
    const v = atributoNuevo.trim();
    if (!v || atributos.length >= MAX_ATRIBUTOS) return;
    setAtributos([...atributos, v]);
    setAtributoNuevo("");
  }

  return (
    <div className={styles.fotoCaja}>
      <div
        className={styles.fotoZona}
        data-arrastrando={arrastrando}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          const archivo = e.dataTransfer.files?.[0];
          if (archivo) void procesar(archivo);
        }}
      >
        <input
          ref={inputArchivoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/*"
          hidden
          data-testid="archivo-foto"
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            if (archivo) void procesar(archivo);
          }}
        />
        <Boton type="button" variante="primario" onClick={() => inputArchivoRef.current?.click()} disabled={estado === "reconociendo"}>
          Buscar por foto
        </Boton>
        <span className={styles.fotoEstado}>JPG, PNG o WebP hasta 5 MB. También puedes arrastrar la foto aquí o pegarla con Ctrl/Cmd+V.</span>
        {miniatura ? /* eslint-disable-next-line @next/next/no-img-element */ <img className={styles.fotoMiniatura} src={miniatura} alt="Foto que se está buscando" /> : null}
        {estado === "reconociendo" ? <span className={styles.fotoEstado}>Reconociendo…</span> : null}
      </div>

      {videoUrl ? (
        <div className={styles.fotoVideo}>
          <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" onLoadedMetadata={alCargarVideo} />
          <input
            type="range"
            min={0}
            max={duracion || 0}
            step={0.1}
            defaultValue={0}
            aria-label="Elegir el cuadro del video"
            onChange={(e) => {
              if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
            }}
          />
          <Boton type="button" variante="primario" onClick={usarCuadroDeVideo} disabled={estado === "reconociendo"}>
            Usar este cuadro
          </Boton>
        </div>
      ) : null}

      {error ? (
        <p className={styles.fotoError} role="alert">
          {error}
        </p>
      ) : null}

      {estado === "listo" ? (
        <>
          {confianzaBaja ? (
            <p className={styles.fotoAviso}>No estoy muy seguro de lo que veo. Revisa y corrige el nombre antes de buscar.</p>
          ) : null}
          <div className={styles.fotoCampos}>
            <Campo etiqueta="Producto reconocido">
              <input className="zx-control" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
            </Campo>
            <Campo etiqueta="Marca">
              <input className="zx-control" value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={40} />
            </Campo>
            <Campo etiqueta="Modelo">
              <input className="zx-control" value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={40} />
            </Campo>
          </div>

          <div className={styles.fotoChips} aria-label="Atributos">
            {atributos.map((a, i) => (
              <span key={`${a}-${i}`} className={styles.fotoChipEditable}>
                {a}
                <button type="button" className={styles.fotoQuitar} aria-label={`Quitar ${a}`} onClick={() => setAtributos(atributos.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
            {atributos.length < MAX_ATRIBUTOS ? (
              <input
                className="zx-control"
                placeholder="Agregar atributo"
                value={atributoNuevo}
                onChange={(e) => setAtributoNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarAtributo();
                  }
                }}
                maxLength={40}
              />
            ) : null}
          </div>

          <div className={styles.fotoChips} aria-label="Búsquedas que se van a hacer">
            <Chip>Búsquedas</Chip>
            {consultas.map((c, i) => (
              <span key={i} className={styles.fotoChipEditable}>
                <input
                  className="zx-control"
                  aria-label={`Búsqueda ${i + 1}`}
                  value={c}
                  onChange={(e) => setConsultas(consultas.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={60}
                />
                <button type="button" className={styles.fotoQuitar} aria-label={`Quitar búsqueda ${i + 1}`} onClick={() => setConsultas(consultas.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>

          <div>
            <Boton type="button" onClick={buscar} disabled={!nombre.trim()}>
              {yaBusco ? "Buscar de nuevo" : "Buscar"}
            </Boton>
          </div>
        </>
      ) : null}
    </div>
  );
}
