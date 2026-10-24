import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";

// Tarea 1.7/1.8 — pantalla de demostración para el criterio de "listo"
// de la 1.7 ("el operador no ve Finanzas"), ahora usando la función
// única de la 1.8 (requierePermiso) en vez del candado a mano que tenía
// antes. No hay todavía ningún dato real de finanzas que mostrar (eso
// es Fase 3) — lo que importa es que el candado funciona de verdad,
// contra la base.
//
// Issue #124 (Z-FIN-02) — "ver" y "editar" van separados: esta
// pantalla solo lee, así que exige "consultar" y nada más. Cuando
// llegue la primera acción que cambie algo de finanzas (Fase 3), su
// actions.ts tiene que pedir "crear" o "modificar" con requierePermiso
// en el servidor — el Auxiliar y el Contador pueden ver Y editar, pero
// un rol con solo "consultar" nunca debe poder guardar nada, aunque
// arme el formulario a mano.
export default async function FinanzasPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    return (
      <>
        <EncabezadoPagina titulo="Finanzas" />
        <EstadoVacio>
          Sin datos reales todavía (llegan en la Fase 3) — esta pantalla solo demuestra que tu rol ({miMembresia.rolNombre}) sí puede verla.
        </EstadoVacio>
        <BotonLink href="/panel" variante="fantasma" chico>
          Volver al panel
        </BotonLink>
      </>
    );
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Finanzas" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }
}
