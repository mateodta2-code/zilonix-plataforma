import { mostrarMonto } from "@/lib/finanzas/montos";
import type { TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla } from "@/components/marco/Tabla";
import { mostrarPorcentajeEntero } from "./formato";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 — las columnas de dinero de una fila del detalle (y del
// «Total por cuenta»). Sin directiva: la usan el Server Component
// DetalleDiaCuentaProducto y el acordeón cliente TablaDetalleAcordeon.
// Costo y utilidad null = venta sin costo: "—" y el chip, nunca un $0
// inventado.
export function CeldasMontos({
  t,
  costo,
  utilidad,
}: {
  t: Omit<TotalesDetalle, "costo_producto" | "utilidad">;
  costo: string | null;
  utilidad: string | null;
}) {
  return (
    <>
      <CeldaTabla className={estilos.numero}>{t.ventas}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.recaudo)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.comision_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.flete_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{costo === null ? <Chip estado="aviso">sin costo</Chip> : mostrarMonto(costo)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.empaque)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.envio)}</CeldaTabla>
      {/* La devolución como concepto aparte llega con #164. */}
      <CeldaTabla className={estilos.numero}>—</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{utilidad === null ? "—" : mostrarMonto(utilidad)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{utilidad === null ? "—" : mostrarPorcentajeEntero(t.porcentaje_utilidad)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarPorcentajeEntero(t.porcentaje_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{t.cantidad}</CeldaTabla>
    </>
  );
}
