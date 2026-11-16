// Semáforo de productos (16-nov): la meta de margen que edita cada
// comercio. Entra como porcentaje ("30", "27,5") y se guarda en
// fracción con 4 decimales ("0.3000"). Sin float.

export const META_MINIMA_PCT = 1;
export const META_MAXIMA_PCT = 99;

// null si no es un porcentaje válido entre 1 y 99, con hasta 2 decimales.
export function leerMetaMargen(texto: string): string | null {
  const limpio = texto.trim().replace("%", "").trim().replace(",", ".");
  const partes = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!partes) return null;
  const [, entero, decimales = ""] = partes;
  const centesimas = Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
  if (centesimas < META_MINIMA_PCT * 100 || centesimas > META_MAXIMA_PCT * 100) return null;
  return `0.${String(centesimas).padStart(4, "0")}`;
}

// "0.3000" -> "30"; "0.2750" -> "27,5". Para el valor del formulario.
export function metaComoPorcentaje(fraccion: string): string {
  const [, decimales = ""] = fraccion.split(".");
  const cuatro = decimales.padEnd(4, "0").slice(0, 4);
  const entero = String(Number(cuatro.slice(0, 2)));
  const resto = cuatro.slice(2).replace(/0+$/, "");
  return resto ? `${entero},${resto}` : entero;
}

// La mitad de la meta, donde empieza el amarillo: "0.3000" -> "0.1500".
// En diezmilésimas enteras, redondeando hacia arriba la media.
export function mitadDeMeta(fraccion: string): string {
  const [, decimales = ""] = fraccion.split(".");
  const diezmilesimas = Number(decimales.padEnd(4, "0").slice(0, 4));
  return `0.${String(Math.ceil(diezmilesimas / 2)).padStart(4, "0")}`;
}
