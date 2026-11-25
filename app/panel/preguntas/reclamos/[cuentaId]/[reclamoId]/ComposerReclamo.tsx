import { urlReclamoEnMl, type PropsAccionesReclamo } from "./AccionesReclamo";
import styles from "./DetalleReclamo.module.css";

// Hueco de Reclamos-B: la caja está deshabilitada; no se envía nada.
export function ComposerReclamo({ siteId, ordenId }: PropsAccionesReclamo) {
  return (
    <div className={styles.composer}>
      <label className={styles.composerTitulo} htmlFor="escribir-comprador">
        Escríbele al comprador
      </label>
      <textarea id="escribir-comprador" className={styles.composerCaja} disabled rows={3} maxLength={350} placeholder="Muy pronto podrás responder desde aquí" />
      <div className={styles.composerPie}>
        <span className={styles.composerContador}>0/350</span>
        <a href={urlReclamoEnMl(siteId, ordenId)} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
          Responder en Mercado Libre
        </a>
      </div>
    </div>
  );
}
