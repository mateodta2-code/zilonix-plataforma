import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { DetalleDiaCuentaProducto } from "@/components/finanzas/DetalleDiaCuentaProducto";
import styles from "./page.module.css";

// Issue #131 — Pedidos es el «Detalle día a día · cuenta · producto»,
// el mismo de Finanzas → Ventas (components/finanzas/
// DetalleDiaCuentaProducto.tsx), sin pestañas ni lista aparte (Sharel lo
// pidió así). La ficha de cada pedido sigue en /panel/pedidos/[id]. Pide
// ventas.consultar para entrar y finanzas.consultar porque todo lo que
// se ve son montos de utilidad; sin eso, aviso y no se consulta nada.
// Sin tarjetas KPI ni «Total por cuenta» (mostrarResumen={false}):
// solo filtros, «Traer ventas de este mes» y la tabla. Los indicadores
// van a Inicio (#143/#163).
// Cualquier ?vista= viejo (lista o detalle) cae acá mismo.
export default async function PedidosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <SinAcceso
        mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede ver Pedidos: muestra montos de utilidad y hace falta acceso a Ventas y a Finanzas.`}
      />
    );
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Pedidos"
        accion={
          <BotonLink href="/panel/despachos" variante="secundario" chico>
            Despachos
          </BotonLink>
        }
      />

      <DetalleDiaCuentaProducto empresaId={empresa.id} usuarioId={usuario.id} searchParams={searchParams} ruta="/panel/pedidos" extra={{}} mostrarResumen={false} />

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
