"use client";

import { CALIDAD_JPEG, LADO_MAXIMO_PX } from "@/lib/entregas/foto";
import { reducirImagen } from "@/lib/imagenes/reducirImagen";

// Domi-3: la foto de entrega o de novedad, reducida en el celular (lado ≤
// 1600 px, JPEG). La lógica vive en lib/imagenes/reducirImagen.ts (también
// la usan los tickets de soporte).
export function reducirFoto(archivo: Blob): Promise<Blob | null> {
  return reducirImagen(archivo, LADO_MAXIMO_PX, CALIDAD_JPEG);
}
