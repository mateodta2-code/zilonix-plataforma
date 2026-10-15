import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { tienePermiso } from "@/lib/roles";

// Tarea 1.7 — pantalla de demostración para el criterio de "listo"
// ("el operador no ve Finanzas"). No hay todavía ningún dato real de
// finanzas que mostrar (eso es Fase 3) — lo que importa acá es que el
// candado de permiso funciona de verdad, contra la base, no que la
// pantalla tenga contenido. La función única que exige esto en CADA
// ruta (y falla el CI si falta) es la tarea 1.8, todavía no construida
// — esta pantalla la hace a mano, una sola vez.
export default async function FinanzasPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeVer = miMembresia ? tienePermiso(miMembresia.permisos, "finanzas", "consultar") : false;

  if (!puedeVer) {
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

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Finanzas</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Sin datos reales todavía (llegan en la Fase 3) — esta pantalla solo demuestra que tu rol (
        {miMembresia?.rolNombre}) sí puede verla.
      </p>
      <Link href="/panel">Volver al panel</Link>
    </main>
  );
}
