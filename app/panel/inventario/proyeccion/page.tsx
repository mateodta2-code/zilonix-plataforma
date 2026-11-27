import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { EnConstruccion } from "@/components/productos/EnConstruccion";

// Issue #280 — Proyección de inventarios (módulo Productos), en construcción: todavía no lee
// datos. Pide inventario.consultar, el mismo permiso del menú.
export default async function ProyeccionInventariosPage() {
  const { usuario, activa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  return (
    <>
      <EncabezadoPagina titulo="Proyección de inventarios" descripcion="Cuánto vas a necesitar y cuándo reponer, según tus ventas." />
      <EnConstruccion />
    </>
  );
}
