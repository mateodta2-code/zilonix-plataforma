import { randomUUID } from "crypto";
import { subirFotoPrivada } from "@/lib/cloudinary";
import { carpetaSoporte } from "./imagenes";

// Sube las capturas ya validadas de un mensaje de ticket, privadas, con el
// nombre <ticket>-<uuid> en la carpeta de la empresa. Devuelve sus ids.
export async function subirImagenesTicket(empresaId: string, ticketId: string, imagenes: Uint8Array[]): Promise<string[]> {
  const ids: string[] = [];
  for (const bytes of imagenes) {
    const { publicId } = await subirFotoPrivada(Buffer.from(bytes), carpetaSoporte(empresaId), `${ticketId}-${randomUUID()}`);
    ids.push(publicId);
  }
  return ids;
}
