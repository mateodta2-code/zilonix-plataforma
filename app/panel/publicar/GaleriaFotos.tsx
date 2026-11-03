"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { moverFoto } from "./formulario-logica";
import { usarSubidaFotoCloudinary } from "./usarSubidaFotoCloudinary";
import { esLinkDeDisenoCanva } from "./canva-link";
import styles from "./publicar.module.css";

const TIPOS_IMAGEN_ACEPTADOS = "image/jpeg,image/png,image/webp";
const LISTA_TIPOS_IMAGEN_ACEPTADOS = TIPOS_IMAGEN_ACEPTADOS.split(",");

// BAJO, review PR #372 — el input de archivo ya filtra con `accept`,
// pero un drop desde el escritorio no respeta ese atributo (el SO deja
// soltar cualquier cosa). Se filtra acá para no mandar un .pdf o un
// .docx a la ruta de subida.
function soloImagenes(archivos: File[]): File[] {
  return archivos.filter((archivo) => LISTA_TIPOS_IMAGEN_ACEPTADOS.includes(archivo.type));
}

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
  limiteFotos,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  cloudinaryConfigurado: boolean;
  limiteFotos: number | null;
}) {
  const [agregandoUrlManual, setAgregandoUrlManual] = useState(false);
  const [urlNueva, setUrlNueva] = useState("");
  const [indiceArrastrado, setIndiceArrastrado] = useState<number | null>(null);
  const [fotoRota, setFotoRota] = useState<Record<number, boolean>>({});
  const [avisoLimite, setAvisoLimite] = useState<string | null>(null);

  const [canvaUrl, setCanvaUrl] = useState("");
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  // MEDIO, review PR #372 — cuántas fotos están en vuelo (ya aceptadas
  // por el cupo pero todavía subiendo) entre un drop/selección y el
  // siguiente, para no pasarse de `limiteFotos` si se sueltan dos
  // tandas antes de que la primera termine.
  const fotosEnVueloRef = useRef(0);
  // MEDIO 1, review 2 del PR #372 — `urls` (prop) queda vieja si una
  // segunda tanda termina de subir antes de que el padre re-renderice
  // con el resultado de la primera: dos lotes en vuelo comparten la
  // misma `urls` cerrada al momento de soltarlos. `urlsRef` es la
  // fuente de verdad real: se sincroniza con la prop en cada render Y
  // se actualiza al toque cuando un lote termina, así el siguiente que
  // termine ya ve lo que agregó el anterior.
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  function agregarUrls(nuevas: string[]) {
    const actualizado = [...urlsRef.current, ...nuevas];
    urlsRef.current = actualizado;
    onChange(actualizado);
  }

  const {
    subiendo,
    error: errorSubida,
    codigoError,
    progreso,
    subirArchivos,
    subirCanvaUrl,
    subirDisenoCanva,
  } = usarSubidaFotoCloudinary(
    (url) => agregarUrls([url]),
    // ALTO 1, review PR #372 — una sola llamada a onChange con todas
    // las URL del lote (ya en orden de selección, ver subirArchivos en
    // usarSubidaFotoCloudinary.ts), en vez de una por foto con el
    // `urls` viejo.
    (nuevas) => agregarUrls(nuevas)
  );

  // Code review de Pablo (PR #368, review 5757123834) — codigoError
  // llegaba del servidor pero no se usaba para nada: la persona veía
  // el error crudo sin ninguna indicación de qué hacer. "no_conectado"
  // tiene una acción concreta (el botón ConectarCanva, ahora arriba del
  // todo en Publicar — ver FormularioPublicar.tsx); cualquier otro
  // código que llegue a futuro, sin una acción propia todavía, al menos
  // dice qué intentar en vez de quedar mudo.
  function textoDeAccionPorCodigo(codigo: string | null): string | null {
    if (!codigo) return null;
    if (codigo === "no_conectado") return "Usa el botón \"Conectar Canva\", arriba de esta sección.";
    return "Intenta de nuevo en unos segundos; si sigue pasando, avisa a soporte.";
  }

  function confirmarAgregarUrlManual() {
    const limpia = urlNueva.trim();
    if (limpia) onChange([...urls, limpia]);
    setUrlNueva("");
    setAgregandoUrlManual(false);
  }

  // Respeta el límite de fotos de la categoría (maxFotos, detectado en
  // FormularioPublicar): si el lote se pasa, sube solo hasta llenar el
  // cupo y avisa cuántas quedaron fuera — a diferencia del límite al
  // publicar (que solo recorta en silencio), acá la persona eligió esas
  // fotos a propósito y merece saber que algunas no entraron.
  function subirRespetandoLimite(archivos: File[]) {
    setAvisoLimite(null);
    // MEDIO 2, review 2 del PR #372 — `fotosEnVueloRef` se lleva
    // siempre, haya o no `limiteFotos`: si no se lleva mientras no hay
    // límite, un cambio posterior de categoría (que SÍ trae límite)
    // mientras ese lote sin límite todavía está subiendo no se enteraría
    // de esas fotos en vuelo y dejaría pasar de más.
    let admitidos = archivos;
    if (limiteFotos != null) {
      // El cupo se cuenta contra las fotos ya puestas MÁS las que ya
      // están en vuelo de un drop/selección anterior que todavía no
      // terminó, no solo contra `urls.length`.
      const espacio = Math.max(0, limiteFotos - urls.length - fotosEnVueloRef.current);
      admitidos = archivos.slice(0, espacio);
      const sobrantes = archivos.length - admitidos.length;
      if (sobrantes > 0) {
        setAvisoLimite(
          `Esta categoría admite hasta ${limiteFotos} fotos — ${sobrantes} ${sobrantes === 1 ? "foto quedó" : "fotos quedaron"} fuera por el límite.`
        );
      }
    }
    if (admitidos.length > 0) {
      fotosEnVueloRef.current += admitidos.length;
      void subirArchivos(admitidos).finally(() => {
        fotosEnVueloRef.current -= admitidos.length;
      });
    }
  }

  function alElegirArchivos(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite elegir los MISMOS archivos dos veces seguidas
    if (archivos.length > 0) subirRespetandoLimite(archivos);
  }

  // Dos caminos bien distintos bajo el mismo campo: el link de
  // "Compartir"/edición de un DISEÑO (canva.link/... o
  // canva.com/design/<id>/...) trae TODAS sus páginas vía la cuenta de
  // Canva conectada del usuario; cualquier otro link (media.canva.com,
  // *.canvausercontent.com — una exportación ya hecha) sigue el camino
  // de siempre, sin cambios — ver canva-link.ts para el criterio exacto.
  function confirmarCanvaUrl() {
    const limpia = canvaUrl.trim();
    if (!limpia) return;
    if (esLinkDeDisenoCanva(limpia)) {
      void subirDisenoCanva(limpia, () => setCanvaUrl(""));
    } else {
      subirCanvaUrl(limpia, () => setCanvaUrl(""));
    }
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
    const archivos = soloImagenes(Array.from(e.dataTransfer.files ?? []));
    if (archivos.length > 0) {
      subirRespetandoLimite(archivos);
      return;
    }
    if (indiceArrastrado == null) return;
    onChange(moverFoto(urls, indiceArrastrado, indiceDestino));
    setIndiceArrastrado(null);
  }

  function alSoltarEnAgregar(e: React.DragEvent) {
    e.preventDefault();
    const archivos = soloImagenes(Array.from(e.dataTransfer.files ?? []));
    if (archivos.length > 0) subirRespetandoLimite(archivos);
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

        <input ref={inputArchivoRef} type="file" accept={TIPOS_IMAGEN_ACEPTADOS} multiple onChange={alElegirArchivos} hidden />

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
            {subiendo ? (
              <span style={{ fontSize: 11 }}>{progreso ? `Subiendo ${Math.min(progreso.completados + 1, progreso.total)} de ${progreso.total}` : "Subiendo…"}</span>
            ) : (
              "+"
            )}
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
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
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
          {errorSubida && (
            <p style={{ fontSize: 12, color: "var(--kpi-peligro-texto)", marginTop: 6 }}>
              {errorSubida}
              {textoDeAccionPorCodigo(codigoError) && <> {textoDeAccionPorCodigo(codigoError)}</>}
            </p>
          )}
          {avisoLimite && <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 6 }}>{avisoLimite}</p>}
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
