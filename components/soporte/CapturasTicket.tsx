// Muestra las capturas de un mensaje de ticket. `base` es la ruta que las
// entrega con su propio candado: /api/soporte/imagen (vendedor) o
// /superadmin/soporte-imagen (superadmin). Al tocarla se amplía en la MISMA
// pestaña (FotoConZoom: fondo oscuro, se cierra con ✕, Esc o tocando fuera)
// — pedido del usuario: antes abría otra pestaña del navegador.
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import styles from "./Capturas.module.css";

export function CapturasTicket({ base, ticketId, archivos }: { base: string; ticketId: string; archivos: string[] }) {
  if (archivos.length === 0) return null;
  return (
    <div className={styles.galeria}>
      {archivos.map((a, i) => (
        <FotoConZoom key={a} src={`${base}/${ticketId}/${a}`} alt={`Captura ${i + 1}`} claseMiniatura={styles.miniaturaTicket} />
      ))}
    </div>
  );
}
