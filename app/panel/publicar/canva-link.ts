// Code review de Pablo (PR #368, review 5757123834, hallazgo HIGH) —
// la primera versión trataba CUALQUIER host *.canva.com (incluido
// media.canva.com, el CDN de una exportación YA HECHA) como un link de
// DISEÑO, rompiendo el camino viejo de "pegar el link de una
// exportación" (Parte 3, punto C). Un link de diseño es SOLO
// canva.link/... (el link corto de "Compartir") o
// canva.com/design/<id>/... (el largo, de edición) — media.canva.com y
// *.canvausercontent.com siguen siendo una exportación ya hecha, nunca
// un diseño a exportar.
//
// Función pura, sin "use client" ni nada del lado del servidor (nunca
// importa lib/canva/enlace.ts: ese archivo usa dns/promises, que no
// existe en el navegador) — solo decide qué camino de subida tomar en
// GaleriaFotos.tsx.
//
// Mismo patrón de ID que el servidor (lib/canva/enlace.ts) — un
// canva.com/design/... SIN un id con el prefijo DA tampoco es un
// diseño válido para este camino (ajuste opcional del review, PR
// #368): nunca manda al flujo de exportar-diseño un link que el
// servidor de todas formas va a rechazar con "sin design_id".
const REGEX_DESIGN_ID = /DA[A-Za-z0-9_-]+/;

export function esLinkDeDisenoCanva(valor: string): boolean {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  const h = url.hostname.toLowerCase();
  if (h === "canva.link") return true;
  if ((h === "canva.com" || h === "www.canva.com") && url.pathname.startsWith("/design/")) {
    return REGEX_DESIGN_ID.test(url.pathname);
  }
  return false;
}
