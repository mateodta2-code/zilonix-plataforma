import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarRolesDeEmpresa } from "@/lib/roles";

export default async function RolesPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  if (miMembresia?.rolNombre !== "Dueño") {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Solo el Dueño de {empresa.nombre} puede ajustar los roles.</p>
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
