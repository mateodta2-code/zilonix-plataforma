import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { NOMBRES_PLANTILLA } from "@/lib/roles";
import { crearInvitacionAction } from "./actions";

export default async function InvitarPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  if (miMembresia?.rolNombre !== "Dueño") {
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <p>Solo el Dueño de {empresa.nombre} puede invitar personas.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Invitar a {empresa.nombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Se genera un link de un solo uso que vence en 7 días — nunca se comparte una contraseña.
      </p>

      <form action={crearInvitacionAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <label style={{ fontSize: 13 }}>
          Correo de la persona
          <input
            type="email"
            name="email"
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Rol
          <select name="rol" required style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
            {NOMBRES_PLANTILLA.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={{ padding: "10px 16px", marginTop: 8 }}>
          Generar invitación
        </button>
      </form>

      <Link href="/panel/roles" style={{ display: "inline-block", marginTop: 28, fontSize: 13 }}>
        Ajustar permisos de los roles →
      </Link>
    </main>
  );
}
