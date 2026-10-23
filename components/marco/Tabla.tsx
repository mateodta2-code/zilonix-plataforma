import styles from "./Tabla.module.css";

// Tabla real (no la lista "celular primero" de ListaFilas) — para
// datos genuinamente tabulares con columnas fijas (actividad, la
// matriz de permisos de un rol). Envuelta en overflow-x: auto, igual
// que ya hacían esas dos pantallas, para que una tabla ancha nunca
// empuje el resto de la página en un celular.
export function Tabla({ encabezados, children }: { encabezados: string[]; children: React.ReactNode }) {
  return (
    <div className={styles.envoltura}>
      <table className={styles.tabla}>
        <thead>
          <tr>
            {encabezados.map((encabezado) => (
              <th key={encabezado} className={`zx-etiqueta ${styles.th}`}>
                {encabezado}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function FilaTabla({ children }: { children: React.ReactNode }) {
  return <tr className={styles.tr}>{children}</tr>;
}

export function CeldaTabla({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={[styles.td, className].filter(Boolean).join(" ")}>{children}</td>;
}
