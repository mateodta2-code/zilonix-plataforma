import Link from "next/link";
import styles from "./Hero.module.css";
import portada from "./Portada.module.css";

export default function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.contenido}>
        <p className={styles.etiqueta}>Para vendedores de Mercado Libre en Latinoamérica</p>
        <h1 className={styles.titulo}>
          Gestiona ventas, despachos, inventario y finanzas de tu tienda <span className="zx-texto-plata">en un solo lugar</span>
        </h1>
        <p className={styles.lema}>
          Todo lo que hoy haces repartido entre el panel de Mercado Libre y hojas de cálculo, ahora en un solo panel:
          publicaciones, promociones, publicidad y la utilidad real de cada venta.
        </p>
        <div className={styles.botones}>
          <Link href="/sign-up" className={portada.botonPrimario}>
            Empezar
          </Link>
        </div>
      </div>
    </section>
  );
}
