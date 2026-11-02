import Link from "next/link";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { IconoCheck } from "@/components/marco/iconos";
import { planes } from "./datos";
import styles from "./Portada.module.css";
import propio from "./Planes.module.css";

export default function Planes() {
  return (
    <section id="planes" className={styles.seccion}>
      <div className={styles.contenedor}>
        <h2 className={styles.titulo}>Planes</h2>
        <p className={styles.subtitulo}>Precios en dólares, por mes.</p>

        <div className={styles.grid3}>
          {planes.map((plan) => (
            <Tarjeta key={plan.nombre} className={propio.tarjeta}>
              {plan.destacado && <span className={propio.destacado}>Más elegido</span>}
              <h3 className={styles.cardTitulo}>{plan.nombre}</h3>
              <p className={propio.precio}>
                <span className={propio.precioNumero}>${plan.precioUsd}</span>
                <span className={propio.precioMoneda}>USD / mes</span>
              </p>

              <ul className={propio.incluye}>
                {plan.incluye.map((item) => (
                  <li key={item} className={propio.incluyeItem}>
                    <IconoCheck size={16} className={propio.check} />
                    {item}
                  </li>
                ))}
              </ul>

              <Link href="/sign-up" className={plan.destacado ? styles.botonPrimario : styles.botonSecundario}>
                Elegir plan
              </Link>
            </Tarjeta>
          ))}
        </div>
      </div>
    </section>
  );
}
