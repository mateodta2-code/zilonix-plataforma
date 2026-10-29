import { redirect } from "next/navigation";

// Parte 2 (página única, estructura de Zilonix OS) — "/panel/publicar/
// nuevo redirige a /panel/publicar (con el ancla de la sección)". El
// formulario entero vive ahora en /panel/publicar (FormularioPublicar.tsx,
// movido una carpeta arriba) — nunca se borra esta ruta para no romper
// el botón "Publicar" de Investigación (PanelInvestigacion.tsx), que
// sigue apuntando acá con su prefill (titulo/precio/foto) tal cual.
// Nunca checkea sesión/permiso acá: no lee ni escribe nada — el
// permiso real se revisa en /panel/publicar. Por eso está en
// RUTAS_EXENTAS, no en RUTAS_PROTEGIDAS (scripts/verificar-permisos.test.ts).
export default function PublicarNuevoPage({ searchParams }: { searchParams: { titulo?: string; precio?: string; foto?: string } }) {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(searchParams)) {
    if (valor) params.set(clave, valor);
  }
  const query = params.toString();
  redirect(`/panel/publicar${query ? `?${query}` : ""}#formulario-publicar`);
}
