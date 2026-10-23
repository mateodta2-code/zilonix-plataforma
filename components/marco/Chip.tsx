import styles from "./Chip.module.css";

export type EstadoChip = "neutro" | "exito" | "peligro" | "aviso";

// Etiqueta chica de estado — MAYÚSCULAS, borde de 1px, color según el
// estado. Reemplaza los <span style={{opacity:...}}> sueltos que cada
// pantalla usaba para "activo"/"vencido"/"revocado", etc.
export function Chip({ estado = "neutro", children }: { estado?: EstadoChip; children: React.ReactNode }) {
  return (
    <span className={`zx-etiqueta ${styles.chip}`} data-estado={estado}>
      {children}
    </span>
  );
}
