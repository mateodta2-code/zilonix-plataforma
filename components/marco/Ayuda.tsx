import styles from "./Ayuda.module.css";

// Issue #193 — Sharel: "junto a una etiqueta, un '?' accesible
// (hover/focus) que explique en español simple cómo pegar algo" —
// solo CSS (:hover/:focus-within), nunca JS: un <button type="button">
// nunca dispara el submit del formulario que lo rodea, y
// aria-describedby conecta el botón con el texto de ayuda para
// lectores de pantalla (que no dependen del hover).
export function Ayuda({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span className={styles.contenedor}>
      <button type="button" className={styles.boton} aria-describedby={id} aria-label="Ayuda">
        ?
      </button>
      <span role="tooltip" id={id} className={styles.globo}>
        {children}
      </span>
    </span>
  );
}
