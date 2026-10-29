import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { PaginaPromociones } from "./PaginaPromociones";

// Rama feat-promociones, punto 3 — "una sola página /panel/promociones".
// Server Component mínimo: resuelve sesión/empresa/permiso y las
// cuentas conectadas; todo lo demás (buscar, candidatos, reglas,
// historial, aplicar) lo hace el cliente con fetch a las rutas de
// app/api/ml/promociones/ — mismo criterio que SeccionClip.tsx.
export default async function PromocionesPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Promociones" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeAprobar = tienePermiso(miMembresia?.permisos ?? [], "promociones", "aprobar");
  const puedeEjecutar = tienePermiso(miMembresia?.permisos ?? [], "promociones", "ejecutar");

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, nickname: c.nickname }));

  return (
    <>
      <EncabezadoPagina
        titulo="Promociones"
        descripcion="Revisa las promociones reales de Mercado Libre y aplicá solo las que cumplen tus reglas — el precio mínimo de Finanzas siempre manda."
      />
      <PaginaPromociones cuentas={cuentas} puedeAprobar={puedeAprobar} puedeEjecutar={puedeEjecutar} />
    </>
  );
}
