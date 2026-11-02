import { Tarjeta } from "@/components/marco/Tarjeta";
import { puntosProblema } from "./datos";
import styles from "./Portada.module.css";

export default function Problema() {
  return (
    <section className={styles.seccion}>
      <div className={styles.contenedor}>
        <h2 className={styles.titulo}>El día a día de vender en Mercado Libre, hoy</h2>
        <div className={styles.grid3}>
          {puntosProblema.map((p) => (
            <Tarjeta key={p.titulo}>
              <h3 className={styles.cardTitulo}>{p.titulo}</h3>
              <p className={styles.cardTexto}>{p.texto}</p>
            </Tarjeta>
          ))}
        </div>
      </div>
    </section>
  );
}
