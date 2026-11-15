import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { leerResumenMaestraSku } from "@/lib/ml/promocionesPublicaciones";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { PaginaPromocionesReal } from "./PaginaPromocionesReal";

// Tarea "Promociones real" (Refs #295) — reemplaza el diseño viejo
// (cola de candidatos → aprobar → "Lanzar aprobadas") por la maqueta
// que Mateo ya revisó y aprobó en /panel/promociones-prueba: lista por
// publicación, con "Participar"/"Dejar de participar" directos. El
// módulo viejo (PaginaPromociones.tsx y sus rutas de /api) queda
// INTACTO en el repo — nunca se borra sin que Mateo lo autorice —
// simplemente esta página ya no lo renderiza.
// Server Component mínimo: resuelve sesión/empresa/permiso, las
// cuentas conectadas y el resumen de la tabla maestra de SKU; todo lo
// demás lo hace el cliente con fetch a app/api/ml/promociones/publicaciones/.
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
  const puedeEjecutar = tienePermiso(miMembresia?.permisos ?? [], "promociones", "ejecutar");

  const [cuentasConectadas, resumenMaestraSku] = await Promise.all([listarCuentasConectadas(empresa.id), leerResumenMaestraSku(empresa.id)]);
  const cuentas = cuentasConectadas.filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, nickname: c.nickname, siteId: c.siteId }));

  return (
    <>
      <EncabezadoPagina
        titulo="Promociones"
        descripcion="Estado real de cada publicación en Mercado Libre — participar o salir de una promoción, siempre con el precio mínimo de Finanzas como límite."
      />
      <PaginaPromocionesReal
        cuentas={cuentas}
        puedeEjecutar={puedeEjecutar}
        resumenMaestraSku={{ total: resumenMaestraSku.total, actualizadoTs: resumenMaestraSku.actualizadoTs?.toISOString() ?? null }}
      />
    </>
  );
}
