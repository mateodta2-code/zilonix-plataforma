import { NextResponse } from "next/server";
import { descargarFotoPrivada } from "@/lib/cloudinary";

// Descarga firmada una imagen privada de Cloudinary y la responde cruda, sin
// caché compartida. Quien llama YA comprobó quién la pide y que el id es
// suyo: acá solo se entrega. La URL de Cloudinary nunca sale del servidor.
export async function responderImagenPrivada(publicId: string, origen: string): Promise<NextResponse> {
  try {
    const { bytes, contentType } = await descargarFotoPrivada(publicId);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(`[${origen}] no se pudo descargar la imagen:`, error instanceof Error ? error.name : error);
    return NextResponse.json({ error: "No se pudo cargar la imagen." }, { status: 502 });
  }
}
