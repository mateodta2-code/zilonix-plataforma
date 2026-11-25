"use client";

import { CALIDAD_JPEG, LADO_MAXIMO_PX } from "@/lib/entregas/foto";

// Domi-3: la foto se reduce en el celular (lado ≤ 1600 px, JPEG) antes de
// enviarla: sube rápido con datos móviles y nunca pasa del límite del
// servidor. createImageBitmap respeta la orientación de la cámara.
export async function reducirFoto(archivo: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolver) => canvas.toBlob((b) => resolver(b), "image/jpeg", CALIDAD_JPEG));
  } catch {
    return null;
  }
}
