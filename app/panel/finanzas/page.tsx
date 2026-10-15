import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Tarea 1.7/1.8 — pantalla de demostración para el criterio de "listo"
// de la 1.7 ("el operador no ve Finanzas"), ahora usando la función
// única de la 1.8 (requierePermiso) en vez del candado a mano que tenía
// antes. No hay todavía ningún dato real de finanzas que mostrar (eso
// es Fase 3) — lo que importa es que el candado funciona de verdad,
// contra la base.
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
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Finanzas</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Sin datos reales todavía (llegan en la Fase 3) — esta pantalla solo demuestra que tu rol (
          {miMembresia.rolNombre}) sí puede verla.
        </p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Finanzas</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.
        </p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }
}
