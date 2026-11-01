import { Tarjeta } from "@/components/marco/Tarjeta";
import { capturas } from "./datos";
import styles from "./Portada.module.css";
import propio from "./Capturas.module.css";

export default function Capturas() {
  return (
    <section className={styles.seccion}>
      <div className={styles.contenedor}>
        <h2 className={styles.titulo}>El panel en acción</h2>
        <div className={styles.grid3}>
          {capturas.map((c) => (
            <Tarjeta key={c.id} className={propio.tarjeta}>
              <img src="/capturas/placeholder.svg" alt={`Captura próximamente: ${c.etiqueta}`} className={propio.imagen} />
              <p className={propio.etiqueta}>{c.etiqueta}</p>
            </Tarjeta>
          ))}
        </div>
      </div>
    </section>
  );
}
