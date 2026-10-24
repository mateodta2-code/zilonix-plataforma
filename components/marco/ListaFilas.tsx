import Link from "next/link";
import styles from "./ListaFilas.module.css";

// Lista "celular primero" de filas finas con hover — mismo patrón que
// ya usaban pedidos/despachos/SKU (un <ul><li> con borde abajo), solo
// que ahora comparten los tokens del marco en vez de estilos sueltos.
export function ListaFilas({ children }: { children: React.ReactNode }) {
  return <ul className={styles.lista}>{children}</ul>;
}

export function FilaLista({ href, children }: { href?: string; children: React.ReactNode }) {
  if (href) {
    return (
      <li className={styles.fila}>
        <Link href={href} className={styles.filaEnlace}>
          {children}
        </Link>
      </li>
    );
  }
  return (
    <li className={styles.fila}>
      <div className={styles.filaContenido}>{children}</div>
    </li>
  );
}
