import { Tarjeta } from "@/components/marco/Tarjeta";
import { iconoDeClave } from "@/components/marco/iconos";
import { modulos } from "./datos";
import styles from "./Portada.module.css";

export default function Modulos() {
  return (
    <section id="modulos" className={styles.seccion}>
      <div className={styles.contenedor}>
        <h2 className={styles.titulo}>Todo lo que necesitas para vender, en un solo panel</h2>
        <div className={styles.gridModulos}>
          {modulos.map((m) => (
            <Tarjeta key={m.titulo}>
              <div className={styles.iconoCaja}>{iconoDeClave(m.clave, { size: 20 })}</div>
              <h3 className={styles.cardTitulo}>{m.titulo}</h3>
              <p className={styles.cardTexto}>{m.texto}</p>
            </Tarjeta>
          ))}
        </div>
      </div>
    </section>
  );
}
