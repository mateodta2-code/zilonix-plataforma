import { BotonLink } from "@/components/marco/Boton";
import { dominioMl } from "@/lib/ml/sitios";
import styles from "./DetalleReclamo.module.css";

// Props que Reclamos-B y C van a usar tal cual: solo cambia el interior.
export type PropsAccionesReclamo = {
  reclamoId: string;
  cuentaId: string;
  etapa: string | null;
  // available_actions del vendedor (respondent), ej. "refund", "open_dispute".
  accionesVendedor: string[];
  siteId: string | null;
  // La venta del reclamo, si es una orden.
  ordenId: string | null;
};

// Sin una URL de reclamo documentada por ML, se lleva a la venta (o a la
// lista de ventas). No es un endpoint: solo un link que abre ML.
export function urlReclamoEnMl(siteId: string | null, ordenId: string | null): string {
  const base = `https://myaccount.${dominioMl(siteId)}/sales`;
  return ordenId && /^\d+$/.test(ordenId) ? `${base}/${ordenId}/detail` : `${base}/list`;
}

// Hueco de Reclamos-A: las 3 acciones abren el reclamo en Mercado Libre.
// Aquí NO se llama a ML para escribir nada.
export function AccionesReclamo({ siteId, ordenId }: PropsAccionesReclamo) {
  const href = urlReclamoEnMl(siteId, ordenId);
  const enlace = { href, target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <div className={styles.acciones}>
      <BotonLink variante="secundario" {...enlace}>
        Elegir monto a reembolsar
      </BotonLink>
      <BotonLink variante="secundario" {...enlace}>
        Ofrecer devolución
      </BotonLink>
      <BotonLink variante="fantasma" {...enlace}>
        Contactar a Mercado Libre
      </BotonLink>
    </div>
  );
}
