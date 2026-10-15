import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarRolesDeEmpresa } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Tarea 1.8 — ajustar roles es "autorizar" en "configuracion" (dar o
// quitar permisos es, por definición, un acto de autorización).
// Reemplaza el candado "solo el Dueño" de la tarea 1.7.
export default async function RolesPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "autorizar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol no puede ajustar los roles de {empresa.nombre}.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const roles = await listarRolesDeEmpresa(empresa.id);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Roles de {empresa.nombre}</h1>
      <ul style={{ listStyle: "none", padding: 0, marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {roles.map((rol) => (
          <li
            key={rol.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid currentColor",
              borderRadius: 6,
            }}
          >
            <span>
              {rol.nombre}
              <span style={{ opacity: 0.6, fontSize: 12.5, marginLeft: 8 }}>
                {rol.permisos.length} permiso{rol.permisos.length === 1 ? "" : "s"}
              </span>
            </span>
            {rol.nombre === "Dueño" ? (
              <span style={{ opacity: 0.5, fontSize: 12.5 }}>Siempre todo</span>
            ) : (
              <Link href={`/panel/roles/${rol.id}`} style={{ fontSize: 13 }}>
                Ajustar →
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Link href="/panel/invitar" style={{ display: "inline-block", marginTop: 24, fontSize: 13 }}>
        ← Invitar persona
      </Link>
    </main>
  );
}
