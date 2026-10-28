import styles from "./Chip.module.css";

export type EstadoChip = "neutro" | "exito" | "peligro" | "aviso";

// Etiqueta chica de estado — MAYÚSCULAS, borde de 1px, color según el
// estado. Reemplaza los <span style={{opacity:...}}> sueltos que cada
// pantalla usaba para "activo"/"vencido"/"revocado", etc.
//
// Issue #251 (fix "aproximados siempre visibles") — `title` opcional:
// tooltip nativo del navegador para explicar POR QUÉ falta un dato
// ("falta antigüedad" en "Sin dato") sin agregar una librería de
// tooltips nueva solo para esto.
export function Chip({ estado = "neutro", title, children }: { estado?: EstadoChip; title?: string; children: React.ReactNode }) {
  return (
    <span className={`zx-etiqueta ${styles.chip}`} data-estado={estado} title={title}>
      {children}
    </span>
  );
}
