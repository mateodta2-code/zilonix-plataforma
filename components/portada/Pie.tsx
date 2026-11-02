import Link from "next/link";
import { WHATSAPP_URL } from "./datos";
import styles from "./Pie.module.css";

// El año se calcula en el servidor en cada request (esta página ya es
// dinámica: HomePage siempre consulta la sesión antes de decidir si
// redirige a /panel) — nada que cachear acá.
export default function Pie() {
  const anioActual = new Date().getFullYear();

  return (
    <footer className={styles.pie}>
      <div className={styles.fila}>
        <div className={styles.marca}>
          <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" width={933} height={335} className={styles.logo} />
          <p className={styles.copyright}>© {anioActual} Zilonix Seller. Todos los derechos reservados.</p>
        </div>

        <nav className={styles.enlaces}>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
          <Link href="/cookies">Cookies</Link>
        </nav>

        <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={styles.whatsapp}>
          Escríbenos por WhatsApp
        </a>
      </div>
    </footer>
  );
}
