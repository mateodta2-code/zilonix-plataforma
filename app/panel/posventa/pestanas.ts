// Posventa-0 (Refs #647) — pestañas del módulo. `lista` en false = la
// ruta todavía no existe: la pestaña se muestra deshabilitada con «Muy
// pronto». Posventa-Mensajes (#645) y Posventa-Devoluciones (#648)
// cambian su `lista` a true en una línea, al crear su página.

export type ClavePestanaPosventa = "reclamos" | "mensajes" | "devoluciones";

export type PestanaPosventa = {
  clave: ClavePestanaPosventa;
  etiqueta: string;
  href: string;
  lista: boolean;
};

export const PESTANAS_POSVENTA: PestanaPosventa[] = [
  { clave: "reclamos", etiqueta: "Reclamos y mediaciones", href: "/panel/posventa", lista: true },
  { clave: "mensajes", etiqueta: "Mensajes", href: "/panel/posventa/mensajes", lista: true },
  { clave: "devoluciones", etiqueta: "Devoluciones", href: "/panel/posventa/devoluciones", lista: true },
];

// Pura: qué pestaña corresponde a la ruta. /panel/posventa/mensajes/x
// sigue siendo Mensajes; cualquier otra ruta de Posventa, Reclamos.
export function pestanaActivaPosventa(pathname: string): ClavePestanaPosventa {
  if (pathname === "/panel/posventa/mensajes" || pathname.startsWith("/panel/posventa/mensajes/")) return "mensajes";
  if (pathname === "/panel/posventa/devoluciones" || pathname.startsWith("/panel/posventa/devoluciones/")) return "devoluciones";
  return "reclamos";
}

// Etiqueta con contador; sin número (null) la pestaña queda sin paréntesis.
export function etiquetaConConteo(etiqueta: string, conteo: number | null): string {
  return conteo === null ? etiqueta : `${etiqueta} (${conteo})`;
}
