import type { ReactNode } from "react";
import styles from "./Tabla.module.css";

// Un encabezado puede ser texto (el caso de siempre) o un nodo, para
// un link de orden o un ⓘ. `clave` es la key de React, nunca el texto
// que mandó la URL.
export type EncabezadoTabla = {
  clave: string;
  contenido: ReactNode;
  ariaSort?: "ascending" | "descending" | "none";
  fija?: boolean;
  // Alinea el título a la derecha, encima de celdas `numerica`.
  numerica?: boolean;
  // Clase extra del <th> (p. ej. resaltar una columna).
  className?: string;
};

// Fila opcional de grupos encima de los encabezados (27-nov, detalle de
// Ventas y utilidad): cada grupo abarca `columnas` columnas seguidas.
// Etiqueta vacía = hueco sin título.
export type GrupoEncabezado = {
  clave: string;
  etiqueta: string;
  columnas: number;
  className?: string;
};

// Tabla real (no la lista "celular primero" de ListaFilas) — para
// datos genuinamente tabulares con columnas fijas (actividad, la
// matriz de permisos de un rol). Envuelta en overflow-x: auto, igual
// que ya hacían esas dos pantallas, para que una tabla ancha nunca
// empuje el resto de la página en un celular.
//
// `scroll` limita la altura y pega el encabezado adentro de ESA caja.
// BarraSuperior ya no es sticky (sube con el contenido), pero el
// encabezado pegado sigue siendo contra esa caja, no contra la página.
export function Tabla({
  encabezados,
  children,
  scroll,
  grupos,
}: {
  encabezados: readonly (string | EncabezadoTabla)[];
  children: ReactNode;
  scroll?: boolean;
  grupos?: readonly GrupoEncabezado[];
}) {
  return (
    <div className={scroll ? `${styles.envoltura} ${styles.scroll}` : styles.envoltura}>
      <table className={styles.tabla}>
        <thead>
          {grupos && grupos.length > 0 && (
            <tr>
              {grupos.map((g) => (
                <th key={g.clave} colSpan={g.columnas} className={[`zx-etiqueta ${styles.th}`, g.className ?? ""].filter(Boolean).join(" ")}>
                  {g.etiqueta}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {encabezados.map((encabezado, indice) => {
              if (typeof encabezado === "string") {
                return (
                  <th key={`${encabezado}-${indice}`} className={`zx-etiqueta ${styles.th}`}>
                    {encabezado}
                  </th>
                );
              }
              return (
                <th
                  key={encabezado.clave}
                  className={[`zx-etiqueta ${styles.th}`, encabezado.fija ? styles.thFija : "", encabezado.numerica ? styles.numerica : "", encabezado.className ?? ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-sort={encabezado.ariaSort}
                >
                  {encabezado.contenido}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function FilaTabla({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <tr id={id} className={className ? `${styles.tr} ${className}` : styles.tr}>
      {children}
    </tr>
  );
}

export function CeldaTabla({
  children,
  className,
  colSpan,
  fija,
  numerica,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  fija?: boolean;
  numerica?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      className={[styles.td, fija ? styles.tdFija : "", numerica ? styles.numerica : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </td>
  );
}
