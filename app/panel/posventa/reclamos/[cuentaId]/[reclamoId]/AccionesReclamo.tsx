import { dominioMl } from "@/lib/ml/sitios";
import { motivoNoDisponiblePorDatos } from "@/lib/ml/reclamosResolucion";
import { PanelAccionesDinero } from "./PanelAccionesDinero";
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
  // Reclamos-Dinero: estado y motivo del reclamo, y permiso ventas/modificar.
  estado?: string | null;
  motivoId?: string | null;
  puedeModificar?: boolean;
};

// Sin una URL de reclamo documentada por ML, se lleva a la venta (o a la
// lista de ventas). No es un endpoint: solo un link que abre ML.
export function urlReclamoEnMl(siteId: string | null, ordenId: string | null): string {
  const base = `https://myaccount.${dominioMl(siteId)}/sales`;
  return ordenId && /^\d+$/.test(ordenId) ? `${base}/${ordenId}/detail` : `${base}/list`;
}

// Reclamos-Dinero (Refs #646): las acciones de dinero viven en
// PanelAccionesDinero (cliente). Este wrapper calcula, en el servidor, si
// cada acción está disponible para el vendedor; si no, el botón queda
// deshabilitado con el motivo y un link «Abrir en Mercado Libre».
export function AccionesReclamo({ cuentaId, reclamoId, siteId, ordenId, accionesVendedor, estado, motivoId, puedeModificar }: PropsAccionesReclamo) {
  const datos = { estado: estado ?? null, motivoId: motivoId ?? null, acciones: accionesVendedor };
  return (
    <div className={styles.acciones}>
      <PanelAccionesDinero
        cuentaId={cuentaId}
        reclamoId={reclamoId}
        siteId={siteId}
        urlMl={urlReclamoEnMl(siteId, ordenId)}
        sinPermiso={puedeModificar === true ? null : "Tu rol no tiene permiso para resolver reclamos."}
        motivos={{
          reembolso_parcial: motivoNoDisponiblePorDatos(datos, "reembolso_parcial"),
          reembolso_total: motivoNoDisponiblePorDatos(datos, "reembolso_total"),
          devolucion: motivoNoDisponiblePorDatos(datos, "devolucion"),
          mediacion: motivoNoDisponiblePorDatos(datos, "mediacion"),
        }}
      />
    </div>
  );
}
