// Issue "zoom de despachos" (fix-zoom-tamano) — pedido_items.imagen_url
// solo guarda la MINIATURA de Mercado Libre (secure_thumbnail/thumbnail
// de /items, ver publicacionesDesdeItemsMl en lib/finanzas/venta-ml.ts
// — nunca pictures, que hoy no se pide). El modal de zoom necesita la
// versión grande SIN pedirle nada nuevo a Mercado Libre: mlstatic
// repite cada foto con el MISMO nombre de archivo, cambiando solo el
// sufijo de tamaño antes de la extensión (-I/-V/-S/... = chica, -O =
// grande/Original) — mismo patrón YA confirmado real y probado en este
// mismo repo (extension/lectores/mercadolibre.js, urlFotoGrande/
// deduplicarFotosMl), nunca adivinado de nuevo acá. No se importa ese
// archivo (es JS plano del content script de la extensión, build/
// runtime aparte) — se reusa el mismo regex exacto.
export function urlFotoGrandeMl(url: string): string {
  return url.replace(/-[A-Za-z]\.(jpg|jpeg|png|webp)(\?.*)?$/i, "-O.$1");
}
