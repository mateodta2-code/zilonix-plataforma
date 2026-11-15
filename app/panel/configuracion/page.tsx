import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerConexionIA } from "@/lib/ia/conexion";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { ConfiguracionIA } from "./ConfiguracionIA";

// Rama feat-promociones, punto 6 — "En Configuración, una sección
// 'Conexión de IA' por empresa". Página mínima: no existía ninguna
// pantalla de Configuración todavía (solo "Actividad" usa ese
// permiso), así que esta es la primera — con una sola sección, sin
// pretender ser una pantalla de ajustes general todavía.
export default async function ConfiguracionPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Configuración" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeModificar = tienePermiso(miMembresia?.permisos ?? [], "configuracion", "modificar");
  const conexion = await obtenerConexionIA(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Configuración" descripcion="Ajustes generales de la empresa." />
      <ConfiguracionIA conexionInicial={conexion ? { ...conexion, actualizadoTs: conexion.actualizadoTs.toISOString() } : null} puedeModificar={puedeModificar} />
    </>
  );
}
