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
// Diseño (27-nov): lo que se descuenta va en gris con «−» (estilos.menos)
// y Utilidad + Margen en la franja de «Lo que ganaste» (estilos.resultado),
// con el margen en una pastilla verde o roja.
type Signo = "positivo" | "negativo" | "cero";
function signo(valor: string | null): Signo {
  if (valor === null || /^-?0*(\.0*)?$/.test(valor)) return "cero";
  return valor.startsWith("-") ? "negativo" : "positivo";
}
const RESULTADO = `${estilos.numero} ${estilos.resultado}`;
const MENOS = `${estilos.numero} ${estilos.menos}`;

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
      <CeldaTabla className={MENOS}>{mostrarMonto(t.comision_ml)}</CeldaTabla>
      <CeldaTabla className={MENOS}>{mostrarMonto(t.flete_ml)}</CeldaTabla>
      <CeldaTabla className={costo === null ? estilos.numero : MENOS}>
        {costo === null ? (
          <Chip estado="aviso" title="Esta venta no tiene costo en la Tabla maestra: queda fuera de la utilidad.">
            falta costo
          </Chip>
        ) : (
          mostrarMonto(costo)
        )}
      </CeldaTabla>
      <CeldaTabla className={MENOS}>{mostrarMonto(t.empaque)}</CeldaTabla>
      <CeldaTabla className={MENOS}>{mostrarMonto(t.envio)}</CeldaTabla>
      <CeldaTabla className={`${RESULTADO} ${estilos[signo(utilidad)]}`}>
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
      <CeldaTabla className={RESULTADO}>
        {utilidad === null || t.porcentaje_utilidad === null ? (
          <span className={estilos.suaveCelda}>—</span>
        ) : (
          <span className={`${estilos.pastilla} ${estilos[`pastilla_${signo(t.porcentaje_utilidad)}`]}`}>{mostrarPorcentajeEntero(t.porcentaje_utilidad)}</span>
        )}
      </CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarPorcentajeEntero(t.porcentaje_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{t.cantidad}</CeldaTabla>
    </>
  );
}
