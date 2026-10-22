// Parsers del HTML público del INVIMA (listado y detalle de una alerta).
// Mismas expresiones que lib/alertas-sanitarias.js del Zilonix OS: no hay
// librería de HTML a propósito (el issue pide no agregar dependencias).
//
// El encabezado que lee el detalle es «Descripción del problema». En el
// sitio público del 2026-10-22 algunas alertas (el colágeno Beauty Bloom,
// fixture detalle-colageno-beauty-bloom.html) dicen «Descripción del caso».
// Esas quedan con problema vacío, igual que el OS: no se amplía el patrón
// hasta que Frankie confirme que hay que leer los dos títulos.

function textoPlano(html: unknown): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(Number(n)))
    .replace(/\uFFFD/g, "")
    .replace(/^[\s\u00B7\u2022\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fechaDesdeTexto(dmy: unknown): string | null {
  const m = String(dmy || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export type TarjetaListado = {
  slug: string;
  numero: string;
  direccion: string;
  titulo: string;
  tipo: string;
  fecha: string | null;
  motivo: string;
  pdf: string;
};

export function leerTarjetasListado(html: unknown): TarjetaListado[] {
  const tarjetas: TarjetaListado[] = [];
  for (const coincidencia of String(html).matchAll(/<article class="inv-lst-tarjeta([\s\S]*?)<\/article>/g)) {
    const c = coincidencia[1] || "";
    const m = (re: RegExp) => (c.match(re) || [])[1] || "";
    const fecha = fechaDesdeTexto(m(/fecha_publicacion">([\d-]+)</));
    const pie = textoPlano(m(/class="inv-lst-fecha">([\s\S]*?)<\/span>\s*<a/));
    tarjetas.push({
      slug: m(/tarjeta-titulo[^>]*>\s*<a href="([^"]+)"/),
      numero: textoPlano(m(/inv-lst-numero">([\s\S]*?)</)),
      direccion: textoPlano(m(/inv-lst-direccion">[\s\S]*?<span>([\s\S]*?)<\/span>/)),
      titulo: textoPlano(m(/tarjeta-titulo[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)),
      tipo: textoPlano(m(/inv-lst-tag[^"]*">([\s\S]*?)</)),
      fecha,
      motivo: pie.replace(/^[\d-]+\s*\W*/, "").trim(),
      pdf: m(/href="(\/alertas-sanitarias\/\d+\/pdf)"/),
    });
  }
  return tarjetas.filter((t) => t.slug);
}

export type ProductoDetalle = {
  producto: string;
  registro: string;
  titular: string;
  lote: string;
};

export type DetalleAlerta = {
  productos: ProductoDetalle[];
  problema: string;
};

export function leerDetalleAlerta(html: unknown): DetalleAlerta {
  const productos: ProductoDetalle[] = [];
  for (const coincidencia of String(html).matchAll(/<tr>\s*(<td data-etiqueta[\s\S]*?)<\/tr>/g)) {
    const fila = coincidencia[1] || "";
    const celdas: Record<string, string> = {};
    for (const celda of fila.matchAll(/data-etiqueta="([^"]+)">([\s\S]*?)<\/td>/g)) {
      celdas[textoPlano(celda[1])] = textoPlano(celda[2]);
    }
    productos.push({
      producto: celdas["Producto"] || "",
      registro: celdas["Registro sanitario"] || "",
      titular: celdas["Titular"] || "",
      lote: celdas["Lote / Serial"] || "",
    });
  }
  const problema = (String(html).match(/Descripci.n del problema<\/h3>\s*<div class="inv-alerta-bloque">([\s\S]*?)<\/div>/) || [])[1];
  return { productos, problema: textoPlano(problema) };
}
