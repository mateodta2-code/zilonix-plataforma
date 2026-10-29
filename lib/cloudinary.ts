// Revisión de seguridad (hallazgo MED) — marcador real de Next.js/React:
// si algún día este archivo (o algo que lo importe) se cuela en un
// bundle de cliente (ej. un "use client" que lo importa por error), el
// build falla con un error explícito en vez de empaquetar en silencio
// CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET para el navegador. Tiene que
// ser el primer import del archivo — así lo exige la propia convención
// de Next.js/React para que el bundler lo detecte.
import "server-only";

import crypto from "crypto";

// Parte 3, punto C ("fotos: PC + Canva → Cloudinary, sin migración") —
// portado de zilonix-os-web/lib/cloudinary.js (ya confirmado en
// producción: Postgres se había quedado sin espacio por guardar fotos
// como bytea directo en la base — esa migración a Cloudinary ya corrió
// una vez de verdad ahí). Acá SOLO la parte de imágenes (nunca PDF/raw,
// fuera de alcance de la galería de Publicar) — mismo criterio de
// "fetch crudo, sin SDK" que el resto de este repo usa para APIs
// externas (Mercado Libre, Clerk).
//
// Nombres de variable de entorno — MISMOS que ya usaba Zilonix OS
// (nunca inventar nuevos nombres para el mismo secreto): CLOUDINARY_CLOUD_NAME,
// CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET. Se configuran directo en
// Railway — nunca pegadas en código ni en un chat.

// Firma documentada por Cloudinary: se ordenan alfabéticamente los
// parámetros a firmar (sin incluir "file", "cloud_name", "resource_type"
// ni "api_key"), se concatenan como "clave=valor&clave2=valor2", se le
// pega el api_secret al final, y se saca el SHA-1 en hexadecimal de todo
// eso — así Cloudinary puede confirmar que la subida viene de verdad de
// acá, sin exponer el api_secret en el request en sí.
function firmarCloudinary(params: Record<string, string | number>, apiSecret: string): string {
  const cadena = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(cadena + apiSecret).digest("hex");
}

export function cloudinaryConfigurado(): boolean {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

export class CloudinaryNoConfiguradoError extends Error {
  constructor() {
    super("Falta configurar Cloudinary (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET) en Railway.");
    this.name = "CloudinaryNoConfiguradoError";
  }
}

export class CloudinaryRechazoError extends Error {
  constructor(status: number, detalle: string | null) {
    super(`Cloudinary rechazó la subida (HTTP ${status})${detalle ? `: ${detalle}` : ""}.`);
    this.name = "CloudinaryRechazoError";
  }
}

// Sube una imagen y devuelve su URL pública real y permanente
// (secure_url). Comprimida en la subida (misma transformación ya
// confirmada en producción en Zilonix OS: q_auto,w_1600,c_limit — ancho
// máximo 1600px, calidad automática, nunca agranda una foto más chica)
// — Cloudinary guarda YA comprimida la imagen como el archivo
// principal, no una copia derivada aparte.
export async function subirACloudinary(buffer: Buffer | ArrayBuffer, filename: string, contentType: string, carpeta = "zilonix-plataforma"): Promise<{ url: string }> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new CloudinaryNoConfiguradoError();

  const transformacion = "q_auto,w_1600,c_limit";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = firmarCloudinary({ timestamp, folder: carpeta, transformation: transformacion }, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename || "foto");
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", carpeta);
  form.append("transformation", transformacion);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const data = (await res.json().catch(() => null)) as { secure_url?: string; error?: { message?: string } } | null;
  if (!res.ok || !data?.secure_url) {
    throw new CloudinaryRechazoError(res.status, data?.error?.message ?? null);
  }
  return { url: data.secure_url };
}
