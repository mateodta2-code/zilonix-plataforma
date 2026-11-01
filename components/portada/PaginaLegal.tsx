import Link from "next/link";
// Mismo layout centrado que ya usan /sign-in y /sign-up — una sola
// definición de "portada" en app/page.module.css, reutilizada acá para
// no duplicar CSS por 3 páginas que hoy solo dicen "En preparación".
import styles from "@/app/page.module.css";

export default function PaginaLegal({ titulo }: { titulo: string }) {
  return (
    <main className={styles.portada}>
      <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" className={styles.logo} width={260} height={94} />
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{titulo}</h1>
      <p className={styles.lema}>En preparación.</p>
      <Link href="/" className={styles.botonSecundario}>
        Volver al inicio
      </Link>
    </main>
  );
}
