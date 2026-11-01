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
};

// Tabla real (no la lista "celular primero" de ListaFilas) — para
// datos genuinamente tabulares con columnas fijas (actividad, la
// matriz de permisos de un rol). Envuelta en overflow-x: auto, igual
// que ya hacían esas dos pantallas, para que una tabla ancha nunca
// empuje el resto de la página en un celular.
//
// `scroll` limita la altura y pega el encabezado adentro de ESA caja.
// Si el sticky fuera contra la página, quedaría debajo de BarraSuperior,
// que también es sticky.
export function Tabla({
  encabezados,
  children,
  scroll,
}: {
  encabezados: readonly (string | EncabezadoTabla)[];
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className={scroll ? `${styles.envoltura} ${styles.scroll}` : styles.envoltura}>
      <table className={styles.tabla}>
        <thead>
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
                  className={`zx-etiqueta ${styles.th} ${encabezado.fija ? styles.thFija : ""}`}
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

export function FilaTabla({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <tr id={id} className={styles.tr}>
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
