// Muestra las capturas de un mensaje de ticket. `base` es la ruta que las
// entrega con su propio candado: /api/soporte/imagen (vendedor) o
// /superadmin/soporte-imagen (superadmin). Cada una abre en grande en
// otra pestaña.
import styles from "./Capturas.module.css";

export function CapturasTicket({ base, ticketId, archivos }: { base: string; ticketId: string; archivos: string[] }) {
  if (archivos.length === 0) return null;
  return (
    <div className={styles.galeria}>
      {archivos.map((a, i) => {
        const url = `${base}/${ticketId}/${a}`;
        return (
          <a key={a} href={url} target="_blank" rel="noopener noreferrer" className={styles.enlace} title="Ver en grande">
            {/* eslint-disable-next-line @next/next/no-img-element -- ruta propia que exige sesión, no pasa por next/image */}
            <img src={url} alt={`Captura ${i + 1}`} loading="lazy" />
          </a>
        );
      })}
    </div>
  );
}
