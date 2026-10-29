import { useState } from "react";
import { extraerImagenesDeZip, TOPE_BYTES_ZIP_ARCHIVO, TOPE_IMAGENES_POR_ZIP, ZipInvalidoError, ZipVacioError } from "./fotos/zip";

// Feedback real de Mateo (staging) — tanto la galería (GaleriaFotos.tsx)
// como la portada por cuenta (PortadaCuenta.tsx) suben a la MISMA ruta
// (app/api/ml/publicar/fotos/route.ts, ya con allowlist/anti-SSRF/
// magic bytes/tope de 10MB) — este hook junta la mecánica real (fetch,
// estado de carga, error, progreso) una sola vez, para no duplicarla.
//
// Rama feat-publicar-fotos-zip — suma el respaldo "sin Canva": ahora
// también puede recibir VARIOS archivos a la vez, y cualquiera de
// ellos puede ser un .zip (se abre en el navegador con fflate — ver
// fotos/zip.ts — y se suben las imágenes reales que traiga, en orden
// natural). Nunca viaja el ZIP entero a nuestra infraestructura, solo
// las imágenes ya extraídas y validadas, una por una.

export type ProgresoSubida = { actual: number; total: number } | null;

type ArchivoPorSubir = { blob: Blob; nombre: string };

function esArchivoZip(archivo: File): boolean {
  // Heurística de UX, no de seguridad — nunca se confía en esto para
  // decidir si el contenido es seguro: un .zip que en realidad no lo
  // es termina en ZipInvalidoError (fflate falla al parsear el
  // encabezado real); un archivo renombrado a .zip que SÍ es una
  // imagen simplemente no tiene ninguna entrada de imagen adentro y
  // cae en ZipVacioError. La seguridad real de cada imagen extraída
  // sigue siendo su propia firma binaria (tipoImagenPorMagicBytes),
  // nunca el nombre de ningún archivo.
  return archivo.name.toLowerCase().endsWith(".zip");
}

export function usarSubidaFotoCloudinary(alSubir: (url: string) => void) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Punto del pedido — "muestra el progreso ('Subiendo 3 de 8')".
  const [progreso, setProgreso] = useState<ProgresoSubida>(null);
  // Avisos informativos (nunca errores): "se tomaron las primeras N",
  // "se tomó solo la primera imagen para la portada", etc. — texto
  // chico, nunca bloquea nada.
  const [aviso, setAviso] = useState<string | null>(null);

  async function subirUnaForm(form: FormData): Promise<{ url: string } | { error: string }> {
    try {
      const resp = await fetch("/api/ml/publicar/fotos", { method: "POST", body: form });
      const data = (await resp.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!resp.ok || !data?.url) return { error: data?.error ?? "No se pudo subir la imagen." };
      return { url: data.url };
    } catch {
      return { error: "No se pudo subir la imagen — revisá tu conexión e intentá de nuevo." };
    }
  }

  // Punto del pedido — "si una falla las demás siguen": nunca se
  // corta el resto de la tanda por una sola que falle; se junta un
  // error agregado al final, nunca uno por cada falla (eso inundaría
  // la UI en un ZIP de 20).
  async function subirVarias(archivos: ArchivoPorSubir[]) {
    if (archivos.length === 0) return;
    setSubiendo(true);
    setError(null);
    const fallidas: string[] = [];
    let ultimoErrorReal: string | null = null;
    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ actual: i + 1, total: archivos.length });
      const form = new FormData();
      form.append("archivo", archivos[i].blob, archivos[i].nombre);
      const resultado = await subirUnaForm(form);
      if ("url" in resultado) {
        alSubir(resultado.url);
      } else {
        fallidas.push(archivos[i].nombre);
        ultimoErrorReal = resultado.error;
      }
    }
    setProgreso(null);
    setSubiendo(false);
    if (fallidas.length === archivos.length) {
      setError(archivos.length === 1 ? ultimoErrorReal ?? "No se pudo subir la imagen." : `No se pudo subir ninguna imagen (${fallidas.length}).`);
    } else if (fallidas.length > 0) {
      setError(`No se pudieron subir ${fallidas.length} de ${archivos.length} imágenes: ${fallidas.join(", ")}.`);
    }
  }

  function subirArchivo(archivo: File) {
    void subirVarias([{ blob: archivo, nombre: archivo.name }]);
  }

  function subirCanvaUrl(url: string, alTerminar?: () => void) {
    const form = new FormData();
    form.append("canvaUrl", url);
    void (async () => {
      setSubiendo(true);
      setError(null);
      const resultado = await subirUnaForm(form);
      setSubiendo(false);
      if ("url" in resultado) alSubir(resultado.url);
      else setError(resultado.error);
      alTerminar?.();
    })();
  }

  // Punto del pedido — el "+" y el arrastrar/soltar de GaleriaFotos y
  // PortadaCuenta aceptan VARIOS archivos a la vez, y cualquiera puede
  // ser un .zip. `soloUna` (portada por cuenta) — "en la portada solo
  // se toma la primera imagen y se avisa": nunca un error, solo un
  // aviso informativo, y la subida real sigue con esa única imagen.
  async function procesarArchivos(archivosElegidos: File[], soloUna: boolean) {
    setError(null);
    setAviso(null);
    const porSubir: ArchivoPorSubir[] = [];
    const avisos: string[] = [];

    for (const archivo of archivosElegidos) {
      if (!esArchivoZip(archivo)) {
        porSubir.push({ blob: archivo, nombre: archivo.name });
        continue;
      }
      if (archivo.size > TOPE_BYTES_ZIP_ARCHIVO) {
        avisos.push(`"${archivo.name}" supera el tamaño máximo de un ZIP (60MB) — se ignoró.`);
        continue;
      }
      try {
        const buffer = new Uint8Array(await archivo.arrayBuffer());
        const resultado = extraerImagenesDeZip(buffer);
        if (resultado.truncadoPorCantidad) {
          avisos.push(`"${archivo.name}" tenía más de ${TOPE_IMAGENES_POR_ZIP} imágenes — se tomaron solo las primeras ${TOPE_IMAGENES_POR_ZIP}.`);
        }
        if (resultado.omitidas.length > 0) {
          avisos.push(`${resultado.omitidas.length} imagen(es) de "${archivo.name}" se omitieron (tamaño o tipo inválido).`);
        }
        for (const imagen of resultado.imagenes) {
          porSubir.push({ blob: new Blob([imagen.datos], { type: imagen.tipo }), nombre: imagen.nombre });
        }
      } catch (e) {
        if (e instanceof ZipVacioError || e instanceof ZipInvalidoError) avisos.push(`"${archivo.name}": ${e.message}`);
        else avisos.push(`"${archivo.name}": no se pudo leer el ZIP.`);
      }
    }

    let aSubir = porSubir;
    if (soloUna && porSubir.length > 1) {
      avisos.push("Se tomó solo la primera imagen para la portada.");
      aSubir = porSubir.slice(0, 1);
    }

    if (avisos.length > 0) setAviso(avisos.join(" "));
    if (aSubir.length === 0) {
      if (avisos.length === 0) setError("No se encontró ninguna imagen válida para subir.");
      return;
    }
    await subirVarias(aSubir);
  }

  return { subiendo, error, aviso, progreso, subirArchivo, subirCanvaUrl, procesarArchivos };
}
