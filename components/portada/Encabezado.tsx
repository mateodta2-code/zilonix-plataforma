import Link from "next/link";
import styles from "./Encabezado.module.css";
import portada from "./Portada.module.css";

// Tarea feat-portada-pagina-venta — encabezado de la página de venta.
// "Iniciar sesión" va al login de Clerk; "Empezar" al registro — las
// dos rutas internas de siempre (/sign-in, /sign-up), nunca una URL
// externa (antes de esta tarea la página de venta vivía en
// zilonix-seller-web y linkeaba a app.zilonix.com).
export default function Encabezado() {
  return (
    <header className={styles.encabezado}>
      <div className={styles.fila}>
        <Link href="/" aria-label="Zilonix Seller, ir al inicio" className={styles.marca}>
          <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" width={933} height={335} className={styles.logo} />
        </Link>

        <div className={styles.acciones}>
          <Link href="/sign-in" className={styles.enlaceSesion}>
            Iniciar sesión
          </Link>
          <Link href="/sign-up" className={portada.botonPrimario}>
            Empezar
          </Link>
        </div>
      </div>
    </header>
  );
}
