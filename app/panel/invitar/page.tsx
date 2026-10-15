import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { NOMBRES_PLANTILLA } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { crearInvitacionAction } from "./actions";

// Tarea 1.8 — invitar a alguien es "crear" en el módulo "personas":
// reemplaza el candado "solo el Dueño puede invitar" de la tarea 1.7
// por la función única de permisos. El rol "Dueño" sigue siendo el
// único que lo cumple por defecto (nace con todo sobre todo), pero
// ahora es porque tiene el permiso, no porque el código lo compara con
// el texto "Dueño" a mano.
export default async function InvitarPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "personas", "crear");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol no puede invitar personas a {empresa.nombre}.</p>
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
