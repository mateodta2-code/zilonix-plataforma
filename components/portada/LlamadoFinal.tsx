import Link from "next/link";
import styles from "./Portada.module.css";
import propio from "./LlamadoFinal.module.css";

export default function LlamadoFinal() {
  return (
    <section className={propio.seccion}>
      <div className={styles.contenedorAngosto} style={{ textAlign: "center" }}>
        <h2 className={styles.titulo}>Empieza a vender con control, no con Excel</h2>
        <p className={propio.texto}>Crea tu cuenta y conecta tu primera tienda de Mercado Libre en minutos.</p>
        <Link href="/sign-up" className={`${styles.botonPrimario} ${propio.boton}`}>
          Empezar
        </Link>
      </div>
    </section>
  );
}
