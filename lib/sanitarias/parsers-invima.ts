// Issue #61 (Z-NV-03a) — port casi literal de los parsers de HTML del
// listado y el detalle de una alerta del INVIMA, de
// lib/alertas-sanitarias.js (zilonix-os, autor Frankie). Reciben el
// HTML ya descargado (texto plano) — nunca hacen fetch ellos mismos.

export type TarjetaAlertaInvima = {
  slug: string;
  numero: string;
  direccion: string;
  titulo: string;
  tipo: string;
  fecha: string | null;
  motivo: string;
  pdf: string;
};

export type DetalleAlertaInvima = {
  productos: Array<{ producto: string; registro: string; titular: string; lote: string }>;
  problema: string;
};

function textoPlano(html: string | null | undefined): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/�/g, "")
    .replace(/^[\s·•\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fechaDesdeTexto(dmy: string | null | undefined): string | null {
  const m = String(dmy || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function leerTarjetasListado(html: string): TarjetaAlertaInvima[] {
  const tarjetas: TarjetaAlertaInvima[] = [];
  for (const [, c] of String(html).matchAll(/<article class="inv-lst-tarjeta([\s\S]*?)<\/article>/g)) {
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

export function leerDetalleAlerta(html: string): DetalleAlertaInvima {
  const productos: DetalleAlertaInvima["productos"] = [];
  for (const [, fila] of String(html).matchAll(/<tr>\s*(<td data-etiqueta[\s\S]*?)<\/tr>/g)) {
    const celdas: Record<string, string> = {};
    for (const [, k, v] of fila.matchAll(/data-etiqueta="([^"]+)">([\s\S]*?)<\/td>/g)) celdas[textoPlano(k)] = textoPlano(v);
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
