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

  async function subir(body: FormData) {
    setSubiendo(true);
    setError(null);
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

  function subirCanvaUrl(url: string, alTerminar?: () => void) {
    const form = new FormData();
    form.append("canvaUrl", url);
    void subir(form).then(alTerminar);
  }

  return { subiendo, error, subirArchivo, subirCanvaUrl };
}
