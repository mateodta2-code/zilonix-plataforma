import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { contarAvisos } from "@/lib/ml/avisos";

// Tarea 2.4 — "panel interno" que pide el criterio de "listo": cuántos
// avisos de Mercado Libre llegaron y cuántos ya confirmó el trabajador
// contra la API real.
export default async function AvisosMlPage() {
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
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const conteo = await contarAvisos(empresa.id);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Avisos de Mercado Libre</h1>
      <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{conteo.recibidos}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Recibidos</div>
        </div>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{conteo.procesados}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Procesados</div>
        </div>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{conteo.pendientes}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Pendientes</div>
        </div>
      </div>
      <p style={{ marginTop: 24 }}>
        <Link href="/panel" style={{ fontSize: 13 }}>
          Volver al panel
        </Link>
      </p>
    </main>
  );
}
