import { Tarjeta } from "@/components/marco/Tarjeta";
import { preguntasFaq } from "./datos";
import styles from "./Portada.module.css";
import propio from "./Faq.module.css";

export default function Faq() {
  return (
    <section id="faq" className={styles.seccion}>
      <div className={styles.contenedorAngosto}>
        <h2 className={styles.titulo}>Preguntas frecuentes</h2>
        <Tarjeta className={propio.tarjeta}>
          {preguntasFaq.map((p) => (
            <details key={p.pregunta} className={propio.detalle}>
              <summary className={propio.resumen}>
                {p.pregunta}
                <span className={propio.mas} aria-hidden="true">
                  +
                </span>
              </summary>
              <p className={propio.respuesta}>{p.respuesta}</p>
            </details>
          ))}
        </Tarjeta>
      </div>
    </section>
  );
}
