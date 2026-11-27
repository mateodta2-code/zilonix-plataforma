import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { EnConstruccion } from "@/components/productos/EnConstruccion";

// Issue #280 — Devoluciones (módulo Productos), en construcción: todavía no lee
// datos. Pide inventario.consultar, el mismo permiso del menú.
export default async function DevolucionesInventarioPage() {
  const { usuario, activa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  return (
    <>
      <EncabezadoPagina titulo="Devoluciones" descripcion="Mercancía que vuelve a tu bodega y entra otra vez al stock." />
      <EnConstruccion>Las devoluciones de Mercado Libre se siguen viendo en Posventa → Devoluciones.</EnConstruccion>
    </>
  );
}
