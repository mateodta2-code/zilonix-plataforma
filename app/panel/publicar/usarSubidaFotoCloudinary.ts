import { useState } from "react";

// Feedback real de Mateo (staging) — tanto la galería (GaleriaFotos.tsx)
// como la portada por cuenta (FormularioPublicar.tsx) suben a la MISMA
// ruta (app/api/ml/publicar/fotos/route.ts, ya con allowlist/anti-SSRF/
// magic bytes/tope de 10MB) — este hook junta la mecánica real (fetch,
// estado de carga, error) una sola vez, para no duplicarla en los 2
// lugares que ahora la necesitan.
export function usarSubidaFotoCloudinary(alSubir: (url: string) => void) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codigoError, setCodigoError] = useState<string | null>(null);

  async function subir(body: FormData) {
    setSubiendo(true);
    setError(null);
    setCodigoError(null);
    try {
      const resp = await fetch("/api/ml/publicar/fotos", { method: "POST", body });
      const data = (await resp.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!resp.ok || !data?.url) {
        setError(data?.error ?? "No se pudo subir la imagen.");
        return;
      }
      alSubir(data.url);
    } catch {
      setError("No se pudo subir la imagen — revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubiendo(false);
    }
  }

  function subirArchivo(archivo: File) {
    const form = new FormData();
    form.append("archivo", archivo);
    void subir(form);
  }

  // Link directo de una exportación de Canva (media.canva.com /
  // *.canvausercontent.com) — una sola imagen, misma ruta de siempre.
  function subirCanvaUrl(url: string, alTerminar?: () => void) {
    const form = new FormData();
    form.append("canvaUrl", url);
    void subir(form).then(alTerminar);
  }

  // Link de "Compartir" o de edición de un diseño de Canva (corto
  // canva.link/... o largo canva.com/design/<id>/...) — trae TODAS las
  // páginas del diseño vía la cuenta de Canva conectada del usuario
  // (app/api/canva/exportar-diseno), a diferencia de subirCanvaUrl que
  // sirve una sola URL de imagen ya exportada.
  async function subirDisenoCanva(link: string, alTerminar?: () => void) {
    setSubiendo(true);
    setError(null);
    setCodigoError(null);
    try {
      const resp = await fetch("/api/canva/exportar-diseno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const data = (await resp.json().catch(() => null)) as { urls?: string[]; error?: string; codigo?: string } | null;
      if (!resp.ok || !data?.urls?.length) {
        setError(data?.error ?? "No se pudo traer el diseño de Canva.");
        setCodigoError(data?.codigo ?? null);
        return;
      }
      data.urls.forEach((url) => alSubir(url));
    } catch {
      setError("No se pudo traer el diseño de Canva — revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubiendo(false);
      alTerminar?.();
    }
  }

  return { subiendo, error, codigoError, subirArchivo, subirCanvaUrl, subirDisenoCanva };
}
