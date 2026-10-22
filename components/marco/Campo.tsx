import styles from "./Campo.module.css";

// Envoltura de <label> + texto de la etiqueta — el <input>/<select>
// real lo sigue poniendo cada página (mismo name/type/required de
// siempre), con la clase "zx-control" de app/globals.css para que se
// vea igual que el resto del formulario.
export function Campo({ etiqueta, children }: { etiqueta: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className={styles.campo}>
      <span className={styles.etiqueta}>{etiqueta}</span>
      {children}
    </label>
  );
}
