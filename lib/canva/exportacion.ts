import { tipoImagenPorMagicBytes } from "@/app/panel/publicar/fotos/validar-url-externa";
import { subirACloudinary } from "@/lib/cloudinary";

// Export de un diseño a PNG + polling — forma del payload y de la
// respuesta confirmadas contra el código real que ya corre en
// producción en zilonix-os-web/lib/canva.js (exportarDisenoCanva).
const EXPORTS_URL = "https://api.canva.com/rest/v1/exports";
const INTENTOS_MAX = 15;
const ESPERA_MS = 1_500;
// Cada página exportada se descarga de la URL temporal que devuelve
// Canva (su propio CDN, no un host puesto por el usuario) — no hace
// falta todo el aparato anti-SSRF de validar-url-externa.ts para esto,
// pero sí el mismo tope de tamaño, por las dudas.
const TAMANO_MAXIMO_PAGINA_BYTES = 10 * 1024 * 1024;

export class ExportacionCanvaFallidaError extends Error {}
export class ExportacionCanvaDemoradaError extends Error {
  constructor() {
    super("El diseño tardó demasiado, intenta de nuevo.");
    this.name = "ExportacionCanvaDemoradaError";
  }
}
export class ExportacionCanvaSinAccesoError extends Error {
  constructor() {
    super("No tienes acceso a ese diseño.");
    this.name = "ExportacionCanvaSinAccesoError";
  }
}

type JobCanva = { id: string; status: string; urls?: string[]; error?: { message?: string; code?: string } };

async function crearExportacionPng(accessToken: string, designId: string): Promise<string> {
  const res = await fetch(EXPORTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ design_id: designId, format: { type: "png" } }),
  });
  if (res.status === 403 || res.status === 404) {
    throw new ExportacionCanvaSinAccesoError();
  }
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Canva respondió ${res.status} al crear la exportación: ${texto.slice(0, 300)}`);
  }
  const data = (await res.json()) as { job: JobCanva };
  return data.job.id;
}

async function consultarJob(accessToken: string, jobId: string): Promise<JobCanva> {
  const res = await fetch(`${EXPORTS_URL}/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Canva respondió ${res.status} al consultar la exportación: ${texto.slice(0, 300)}`);
  }
  const data = (await res.json()) as { job: JobCanva };
  return data.job;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Crea el export y espera (polling de intervalo fijo, igual que la
// implementación real de referencia) hasta que termine, falle, o se
// agoten los intentos — nunca un spinner infinito.
export async function exportarDisenoPng(accessToken: string, designId: string): Promise<string[]> {
  const jobId = await crearExportacionPng(accessToken, designId);
  for (let intento = 0; intento < INTENTOS_MAX; intento++) {
    await esperar(ESPERA_MS);
    const job = await consultarJob(accessToken, jobId);
    if (job.status === "success") {
      return (job.urls ?? []).filter((u): u is string => Boolean(u));
    }
    if (job.status === "failed") {
      throw new ExportacionCanvaFallidaError(job.error?.message ?? "Canva no pudo exportar el diseño.");
    }
  }
  throw new ExportacionCanvaDemoradaError();
}

// Descarga cada página exportada y la sube a Cloudinary con el mismo
// flujo "signed" ya existente (lib/cloudinary.ts) — nunca expone la URL
// temporal de Canva en pictures.source de Mercado Libre.
export async function subirPaginasACloudinary(urlsPng: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const urlPng of urlsPng) {
    const res = await fetch(urlPng, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`No se pudo descargar una página exportada de Canva (HTTP ${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > TAMANO_MAXIMO_PAGINA_BYTES) {
      throw new Error("Una página exportada de Canva superó el tamaño máximo permitido.");
    }
    const tipoReal = tipoImagenPorMagicBytes(buffer) ?? "image/png";
    const { url } = await subirACloudinary(buffer, "canva.png", tipoReal);
    urls.push(url);
  }
  return urls;
}
