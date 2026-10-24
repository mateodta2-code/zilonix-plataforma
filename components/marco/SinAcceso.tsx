import Link from "next/link";
import styles from "./SinAcceso.module.css";

// Mismo fallback que cada subpágina ya mostraba cuando requierePermiso
// lanza SinPermisoError — el mensaje exacto lo sigue decidiendo cada
// página (varía: "no tiene acceso", "no puede invitar personas a X",
// etc.), esto solo le da un estilo compartido.
export function SinAcceso({
  mensaje,
  volverHref = "/panel",
  volverTexto = "Volver al panel",
}: {
  mensaje: React.ReactNode;
  volverHref?: string;
  volverTexto?: string;
}) {
  return (
    <div className={styles.contenedor}>
      <p className={styles.mensaje}>{mensaje}</p>
      <Link href={volverHref} className={styles.volver}>
        {volverTexto}
      </Link>
    </div>
  );
}
