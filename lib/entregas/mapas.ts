// Domiciliario — abrir la dirección de la entrega en Google Maps o Waze.
// Links universales documentados por cada uno: en el celular abren la app
// si está instalada y, si no, la web. Nada pasa por nuestro servidor.
//  - Google Maps «Directions» (developers.google.com/maps/documentation/urls):
//    https://www.google.com/maps/dir/?api=1&destination=… (api=1 obligatorio;
//    sin travelmode, Maps elige).
//  - Waze deep link (developers.google.com/waze/deeplinks):
//    https://waze.com/ul?q=… (busca la dirección; el domiciliario toca «Ir»).
//    Waze no documenta navigate=yes solo con q, por eso no se usa.

// «Calle 1 # 2-3, Centro, Medellín»: lo que escribió el vendedor, sin
// espacios de más. encodeURIComponent protege el «#» (si no, cortaría la
// URL). null si no hay dirección (entrega cerrada: la base no la devuelve).
export function textoDireccion(e: { direccion: string | null; barrio: string | null; ciudad: string | null }): string | null {
  const partes = [e.direccion, e.barrio, e.ciudad].map((p) => (p ?? "").trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!e.direccion?.trim()) return null;
  return partes.join(", ");
}

export function linkGoogleMaps(direccion: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion)}`;
}

export function linkWaze(direccion: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(direccion)}`;
}
