import { redirect } from "next/navigation";

// Quitar Clip de Publicar — la tarjeta "Publicar Clip (video)" (y su
// ancla #clip) se sacó por completo de /panel/publicar: Mercado Libre
// bloquea la subida de Clips por API para ítems locales (403
// PA_UNAUTHORIZED_RESULT_FROM_POLICIES). Esta ruta sigue redirigiendo
// a /panel/publicar (sin el ancla, que ya no apunta a nada) para no
// romper un link viejo guardado (bookmark, una notificación ya
// mandada con este link, etc.) — nunca checkea sesión/permiso acá, por
// eso sigue en RUTAS_EXENTAS, no en RUTAS_PROTEGIDAS
// (scripts/verificar-permisos.test.ts).
export default function PublicarClipPage({ searchParams }: { searchParams: { cuentaId?: string; sku?: string; itemId?: string; clipSubido?: string; error?: string } }) {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(searchParams)) {
    if (valor) params.set(clave, valor);
  }
  const query = params.toString();
  redirect(`/panel/publicar${query ? `?${query}` : ""}`);
}
