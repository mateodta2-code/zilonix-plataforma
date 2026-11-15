import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarTerceros } from "@/lib/terceros";
import { editarProveedorAction } from "../actions";
import { FormularioProveedor } from "../FormularioProveedor";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "../../finanzas.module.css";

// Issue #128 — editar un tercero. Solo se busca entre los terceros de
// la empresa activa (RLS + filtro por empresa): un id de otra empresa
// da "no encontrado".
export default async function EditarProveedorPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede editar proveedores.`} volverHref="/panel/finanzas/proveedores" volverTexto="Volver" />;
  }

  const tercero = (await listarTerceros(empresa.id, { incluirInactivos: true })).find((t) => t.id === params.id);
  const error = normalizarParametro(searchParams.error);

  return (
    <>
      <EncabezadoPagina titulo={tercero ? `Editar ${tercero.nombre}` : "Editar tercero"} />
      {error && <p className={styles.avisoError}>{error}</p>}
      {tercero ? (
        <Tarjeta>
          <FormularioProveedor accion={editarProveedorAction} valores={tercero} textoBoton="Guardar cambios" />
        </Tarjeta>
      ) : (
        <EstadoVacio>Ese tercero no está en esta empresa.</EstadoVacio>
      )}
      <BotonLink href="/panel/finanzas/proveedores" variante="fantasma" chico className={styles.volver}>
        Volver a proveedores
      </BotonLink>
    </>
  );
}
