import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { DetalleDiaCuentaProducto } from "@/components/finanzas/DetalleDiaCuentaProducto";
import { PanelRecalculoCostos } from "@/components/finanzas/PanelRecalculoCostos";
import styles from "../finanzas.module.css";

// Issue #131 (Z-FIN-09, Parte A) — ventas y utilidad. Filtros por
// cuenta, rango de días de Bogotá (máximo 31, por defecto el mes en
// curso) y con/sin costo. Sin ícono de quitar y sin lápiz: la corrección
// manual es la Parte B. La tabla vive en
// components/finanzas/DetalleDiaCuentaProducto.tsx, la misma que pinta
// /panel/pedidos.
//
// Parte C — «Recalcular costo con la tabla maestra»
// (components/finanzas/PanelRecalculoCostos.tsx): vista previa antes →
// después y confirmación obligatoria. Solo se pinta con
// finanzas.modificar; las actions y el motor lo vuelven a pedir.
export default async function VentasUtilidadPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  let puedeRecalcular = true;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    puedeRecalcular = false;
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Ventas y utilidad"
        descripcion="Utilidad por venta antes de publicidad: recaudo − comisión ML − flete ML − costo − packing − envío agencia."
      />

      <DetalleDiaCuentaProducto
        empresaId={empresa.id}
        usuarioId={usuario.id}
        searchParams={searchParams}
        ruta="/panel/finanzas/ventas"
        acciones={puedeRecalcular ? <PanelRecalculoCostos /> : undefined}
      />

      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
