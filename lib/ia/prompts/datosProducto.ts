// Variables de producto que comparten los tres estilos de imagen. Salen
// SOLO de la ficha confirmada (PR1): un dato sin confirmar va vacío,
// nunca se inventa.

import { fichaEnTexto, idiomaDeSitio, type Ficha } from "@/lib/publicaciones/ficha";

export type DatosProducto = {
  nombreProducto: string;
  fichaConfirmada: string;
  incluye: string;
  usoPrincipal: string;
  publicoObjetivo: string;
  materiales: string;
  ingredientes: string;
  registroSanitario: string;
  nombrePais: string;
  idioma: string;
};

function texto(ficha: Ficha, clave: "nombre" | "uso" | "publicoObjetivo" | "material" | "registroSanitario"): string {
  const campo = ficha[clave];
  return campo.origen === "supuesto" ? "" : (campo.valor ?? "");
}

function lista(ficha: Ficha, clave: "incluye" | "ingredientes"): string {
  const campo = ficha[clave];
  return campo.origen === "supuesto" ? "" : campo.valor.join("; ");
}

export function datosProductoDesdeFicha(ficha: Ficha, siteId: string): DatosProducto {
  const { idioma, pais } = idiomaDeSitio(siteId);
  return {
    nombreProducto: texto(ficha, "nombre"),
    fichaConfirmada: fichaEnTexto(ficha),
    incluye: lista(ficha, "incluye"),
    usoPrincipal: texto(ficha, "uso"),
    publicoObjetivo: texto(ficha, "publicoObjetivo"),
    materiales: texto(ficha, "material"),
    ingredientes: lista(ficha, "ingredientes"),
    registroSanitario: texto(ficha, "registroSanitario"),
    nombrePais: pais,
    idioma,
  };
}

// Bloque «DATOS DEL PRODUCTO» que va ANTES del texto de cada estilo.
export function bloqueDatosProducto(d: DatosProducto): string {
  const linea = (etiqueta: string, valor: string) => `- ${etiqueta}: ${valor || "(no confirmado: no lo muestres ni lo inventes)"}`;
  return [
    "DATOS DEL PRODUCTO (confirmados por el vendedor; lo vacío no se muestra ni se inventa):",
    linea("Producto", d.nombreProducto),
    linea("Uso principal", d.usoPrincipal),
    linea("Público objetivo", d.publicoObjetivo),
    linea("Materiales", d.materiales),
    linea("Ingredientes o componentes", d.ingredientes),
    linea("Qué incluye", d.incluye),
    linea("Registro sanitario", d.registroSanitario),
    "Ficha completa:",
    d.fichaConfirmada,
  ].join("\n");
}
