// Reduce una imagen EN EL NAVEGADOR a JPEG (lado mayor ≤ ladoMaximo) antes
// de enviarla: sube rápido con datos móviles y nunca pasa del límite del
// servidor. Fondo blanco para PNG con transparencia (capturas de pantalla).
// createImageBitmap respeta la orientación de la cámara. null si no se pudo
// leer. Solo para componentes de cliente (usa document y canvas).
export async function reducirImagen(archivo: Blob, ladoMaximo: number, calidad: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolver) => canvas.toBlob((b) => resolver(b), "image/jpeg", calidad));
  } catch {
    return null;
  }
}
