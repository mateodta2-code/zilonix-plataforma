import { Tarjeta } from "@/components/marco/Tarjeta";
import { pasosComoFunciona } from "./datos";
import styles from "./Portada.module.css";

export default function ComoFunciona() {
  return (
    <section className={styles.seccion}>
      <div className={styles.contenedor}>
        <h2 className={styles.titulo}>Cómo funciona</h2>
        <div className={styles.grid3}>
          {pasosComoFunciona.map((paso) => (
            <Tarjeta key={paso.numero}>
              <div className={styles.numeroCirculo}>{paso.numero}</div>
              <h3 className={styles.cardTitulo}>{paso.titulo}</h3>
              <p className={styles.cardTexto}>{paso.texto}</p>
            </Tarjeta>
          ))}
        </div>
      </div>
    </section>
  );
}
