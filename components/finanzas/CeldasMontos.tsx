import Link from "next/link";
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
//
// 27-nov (tabla más clara): sin la columna «Dev.» (siempre salía «—»;
// vuelve con #164), utilidad y margen en verde o rojo, y en una venta
// sin costo, «Cargar costo» lleva a la Tabla maestra con su SKU.
function claseSigno(valor: string | null): string {
  if (valor === null || /^-?0*(\.0*)?$/.test(valor)) return estilos.numero;
  return `${estilos.numero} ${valor.startsWith("-") ? estilos.negativo : estilos.positivo}`;
}

export function CeldasMontos({
  t,
  costo,
  utilidad,
  sku,
}: {
  t: Omit<TotalesDetalle, "costo_producto" | "utilidad">;
  costo: string | null;
  utilidad: string | null;
  // Solo en la fila de un producto: el SKU para el link «Cargar costo».
  sku?: string | null;
}) {
  return (
    <>
      <CeldaTabla className={estilos.numero}>{t.ventas}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.recaudo)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.comision_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.flete_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>
        {costo === null ? (
          <Chip estado="aviso" title="Esta venta no tiene costo en la Tabla maestra: queda fuera de la utilidad.">
            falta costo
          </Chip>
        ) : (
          mostrarMonto(costo)
        )}
      </CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.empaque)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.envio)}</CeldaTabla>
      <CeldaTabla className={claseSigno(utilidad)}>
        {utilidad !== null ? (
          mostrarMonto(utilidad)
        ) : sku ? (
          <Link href={`/panel/finanzas/maestra-sku/editar?sku=${encodeURIComponent(sku)}`} className={estilos.enlace} title="Carga el costo de este SKU en la Tabla maestra">
            Cargar costo
          </Link>
        ) : (
          "—"
        )}
      </CeldaTabla>
      <CeldaTabla className={claseSigno(utilidad === null ? null : t.porcentaje_utilidad)}>
        {utilidad === null ? "—" : mostrarPorcentajeEntero(t.porcentaje_utilidad)}
      </CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarPorcentajeEntero(t.porcentaje_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{t.cantidad}</CeldaTabla>
    </>
  );
}
