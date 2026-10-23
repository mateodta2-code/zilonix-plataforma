import styles from "./EstadoVacio.module.css";

// Mensaje de "no hay nada todavía" — mismo texto que cada pantalla ya
// tenía, solo que ahora comparten un estilo (nunca un número o una
// fila inventada para rellenar el vacío).
export function EstadoVacio({ children }: { children: React.ReactNode }) {
  return <p className={styles.vacio}>{children}</p>;
}
