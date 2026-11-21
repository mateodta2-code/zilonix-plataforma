import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ImportarReporteClient } from "./ImportarReporteClient";
import styles from "../../finanzas.module.css";

// Issue #422 — cargar el «Reporte de transacciones» de Falabella:
// finanzas.modificar (acá, en la acción y en lib/falabella/conciliacion.ts).
export default async function ImportarReporteFalabellaPage() {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede cargar reportes de Falabella.`} volverHref="/panel/finanzas/falabella" volverTexto="Volver" />;
  }

  return (
    <>
      <EncabezadoPagina titulo="Cargar reporte de Falabella" descripcion="Guarda las líneas del reporte de transacciones para conciliar los pagos." />
      <Tarjeta>
        <ImportarReporteClient />
      </Tarjeta>
      <BotonLink href="/panel/finanzas/falabella" variante="fantasma" className={styles.volver}>
        Volver a la conciliación
      </BotonLink>
    </>
  );
}
