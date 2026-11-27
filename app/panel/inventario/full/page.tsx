import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { EnConstruccion } from "@/components/productos/EnConstruccion";

// Issue #280 — Inventario Full (módulo Productos), en construcción: todavía no lee
// datos. Pide inventario.consultar, el mismo permiso del menú.
export default async function InventarioFullPage() {
  const { usuario, activa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  return (
    <>
      <EncabezadoPagina titulo="Inventario Full" descripcion="Lo que tienes en las bodegas Full de Mercado Libre." />
      <EnConstruccion />
    </>
  );
}
