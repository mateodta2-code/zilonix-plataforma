import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ImportarMaestraClient } from "./ImportarMaestraClient";
import styles from "../../finanzas.module.css";

// Issue #128 (Z-FIN-06) — cargar la hoja PRODUCTOS (.xlsx o .csv) a la
// tabla maestra con vista previa y todo o nada.
export default async function ImportarMaestraPage() {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede cargar la tabla maestra.`} volverHref="/panel/finanzas/maestra-sku" volverTexto="Volver" />;
  }

  return (
    <>
      <EncabezadoPagina titulo="Cargar la tabla maestra" descripcion="Crea o actualiza SKU de la tabla maestra. No toca el catálogo de SKU." />
      <Tarjeta>
        <ImportarMaestraClient />
      </Tarjeta>
      <BotonLink href="/panel/finanzas/maestra-sku" variante="fantasma" chico className={styles.volver}>
        Volver a la tabla maestra
      </BotonLink>
    </>
  );
}
