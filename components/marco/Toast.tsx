import type { EstadoChip } from "./Chip";
import styles from "./Toast.module.css";

export type ItemToast = { id: string; texto: string; estado: EstadoChip };

// Rama fix-promociones-edicion, punto 2 — "si el servidor rechaza,
// muestra el motivo... con un toast": un párrafo chico perdido al
// final de la Tarjeta era fácil de no ver (reportado como "no pasa
// nada visible" al aprobar). Pila simple en una esquina fija, sin
// librería nueva — mismos tokens de color que Chip. Quien la usa es
// responsable de ir sacando los items (ej. con un timeout) — este
// componente solo dibuja la pila.
export function Toast({ items, onCerrar }: { items: ItemToast[]; onCerrar: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.contenedor} role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={styles.toast} data-estado={item.estado}>
          <span className={styles.texto}>{item.texto}</span>
          <button type="button" className={styles.cerrar} onClick={() => onCerrar(item.id)} aria-label="Cerrar aviso">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
