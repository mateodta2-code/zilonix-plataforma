import { Tarjeta } from "@/components/marco/Tarjeta";
import { IconoDatosPersonales } from "@/components/marco/iconos";
import styles from "./Portada.module.css";
import propio from "./Garantia.module.css";

export default function Garantia() {
  return (
    <section className={styles.seccion}>
      <Tarjeta className={propio.tarjeta}>
        <IconoDatosPersonales size={36} className={propio.icono} />
        <h2 className={propio.titulo}>Garantía de 14 días</h2>
        <p className={propio.texto}>Si no te gusta, te devolvemos tu dinero en los primeros 14 días.</p>
      </Tarjeta>
    </section>
  );
}
