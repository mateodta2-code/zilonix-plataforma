import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { cambiarEmpresaActiva } from "./actions";

// Tarea 1.6 — pantalla mínima que prueba el criterio de "listo": con un
// usuario en 2 empresas, al cambiar ves datos distintos (acá, el nombre
// y el NIT de la empresa activa) y nunca mezclados. Las pantallas de
// negocio de verdad (ventas, inventario) llegan en la Fase 2.
export default async function PanelPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  if (propias.length === 0) redirect("/crear-empresa");

  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const activa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{activa.nombre}</h1>
          <p style={{ opacity: 0.6, fontSize: 13, margin: "4px 0 0 0" }}>NIT {activa.nit}</p>
        </div>
        <Link href="/cuenta" style={{ fontSize: 13 }}>
          Mi cuenta
        </Link>
      </div>

      {propias.length > 1 && (
        <form action={cambiarEmpresaActiva} style={{ marginTop: 28 }}>
          <label htmlFor="empresaId" style={{ fontSize: 13, opacity: 0.7 }}>
            Cambiar de empresa
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <select id="empresaId" name="empresaId" defaultValue={activa.id} style={{ flex: 1, padding: 8 }}>
              {propias.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <button type="submit" style={{ padding: "8px 16px" }}>
              Cambiar
            </button>
          </div>
        </form>
      )}

      <Link href="/crear-empresa" style={{ display: "inline-block", marginTop: 28, fontSize: 13 }}>
        + Crear otra empresa
      </Link>
    </main>
  );
}
