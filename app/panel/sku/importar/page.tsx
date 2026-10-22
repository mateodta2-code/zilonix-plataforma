import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { ImportarCsvSkusClient } from "./ImportarCsvSkusClient";
import styles from "./page.module.css";

// Issue #58 (Z-ML-09) — importar SKUs desde CSV: subir el archivo, ver
// una vista previa (filas válidas, con cuáles son nuevas y cuáles ya
// existen, y las filas con error y su motivo) y confirmar. Mismo nivel
// de permiso que /panel/sku/sin-vincular ("inventario", "modificar"):
// esto crea/actualiza SKUs reales, no es solo consulta.
export default async function ImportarCsvSkusPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <SinAcceso
        mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede importar SKUs.`}
        volverHref="/panel/sku"
        volverTexto="Volver"
      />
    );
  }

  return (
    <>
      <EncabezadoPagina titulo="Importar SKUs desde CSV" />

      <div className={styles.contenedor}>
        <ImportarCsvSkusClient />
      </div>

      <BotonLink href="/panel/sku" variante="fantasma" chico className={styles.volver}>
        Volver a SKU
      </BotonLink>
    </>
  );
}
