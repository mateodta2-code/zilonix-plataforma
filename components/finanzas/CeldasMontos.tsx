import Link from "next/link";
import { mostrarMonto } from "@/lib/finanzas/montos";
import type { TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla } from "@/components/marco/Tabla";
import { mostrarPorcentajeEntero, tonoMargen } from "./formato";
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
// Estilo Zilonix OS (27-nov): números de ancho fijo sin «−» ni fondos; la
// utilidad en verde o rojo según el signo y el margen con el semáforo
// (tonoMargen: verde desde 30 %, naranja desde 15 %, rojo debajo).
type Signo = "positivo" | "negativo" | "cero";
function signo(valor: string | null): Signo {
  if (valor === null || /^-?0*(\.0*)?$/.test(valor)) return "cero";
  return valor.startsWith("-") ? "negativo" : "positivo";
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
      <CeldaTabla className={`${estilos.numero} ${estilos.utilidadCelda} ${estilos[signo(utilidad)]}`}>
        {utilidad !== null ? (
          mostrarMonto(utilidad)
        ) : sku ? (
          <Link href={`/panel/finanzas/maestra-sku/editar?sku=${encodeURIComponent(sku)}`} className={estilos.botonCosto} title="Carga el costo de este SKU en la Tabla maestra">
            Cargar costo
          </Link>
        ) : (
          "—"
        )}
      </CeldaTabla>
      <CeldaTabla className={`${estilos.numero} ${estilos[`margen_${utilidad === null ? "sin" : tonoMargen(t.porcentaje_utilidad) ?? "sin"}`]}`}>
        {utilidad === null || t.porcentaje_utilidad === null ? <span className={estilos.suaveCelda}>—</span> : mostrarPorcentajeEntero(t.porcentaje_utilidad)}
      </CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarPorcentajeEntero(t.porcentaje_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{t.cantidad}</CeldaTabla>
    </>
  );
}
