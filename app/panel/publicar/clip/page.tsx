import { redirect } from "next/navigation";

// Parte 2 (página única, estructura de Zilonix OS) — "/panel/publicar/
// clip redirige a /panel/publicar (con el ancla de la sección)". La
// sección de Clip vive ahora al final de /panel/publicar — nunca se
// borra esta ruta para no romper un link viejo guardado (bookmark,
// una notificación ya mandada con este link, etc.). Nunca checkea
// sesión/permiso/CLIP_HABILITADO acá: no lee ni escribe nada — el
// permiso real y la bandera se revisan en /panel/publicar (y en
// clip/actions.ts para las 2 acciones reales), no en un simple
// redirect. Por eso está en RUTAS_EXENTAS, no en RUTAS_PROTEGIDAS
// (scripts/verificar-permisos.test.ts).
export default function PublicarClipPage({
  searchParams,
}: {
  searchParams: { cuentaId?: string; sku?: string; itemId?: string; clipSubido?: string; error?: string };
}) {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(searchParams)) {
    if (valor) params.set(clave, valor);
  }
  const query = params.toString();
  redirect(`/panel/publicar${query ? `?${query}` : ""}#clip`);
}
