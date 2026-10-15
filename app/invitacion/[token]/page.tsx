import Link from "next/link";
import { obtenerInvitacionPorToken } from "@/lib/invitaciones";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { aceptarInvitacionAction } from "./actions";

// Tarea 1.7 — ruta pública (middleware.ts): el token en la URL es el
// permiso real, no la sesión. Si la persona todavía no inició sesión,
// se le ofrece hacerlo o registrarse y volver exactamente acá
// (redirect_url) — nunca se le pide una contraseña nueva inventada por
// un administrador (diferencial frente a Bling/Effi).
export default async function InvitacionPage({ params }: { params: { token: string } }) {
  const invitacion = await obtenerInvitacionPorToken(params.token);

  if (!invitacion) {
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Invitación no encontrada</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>Revisa que copiaste el link completo.</p>
      </main>
    );
  }

  if (invitacion.expirada) {
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Esta invitación venció</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>Pídele a quien te invitó que te mande una nueva.</p>
      </main>
    );
  }

  if (invitacion.yaAceptada) {
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Esta invitación ya fue aceptada</h1>
        <Link href="/panel">Ir al panel</Link>
      </main>
    );
  }

  const usuario = await obtenerOCrearUsuarioActual();
  const redirectUrl = `/invitacion/${params.token}`;

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Te invitaron a {invitacion.empresaNombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Como <b>{invitacion.rolNombre}</b>, para {invitacion.email}.
      </p>

      {usuario ? (
        <form action={aceptarInvitacionAction} style={{ marginTop: 24 }}>
          <input type="hidden" name="token" value={params.token} />
          <button type="submit" style={{ padding: "10px 16px" }}>
            Aceptar y entrar a {invitacion.empresaNombre}
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`}
            style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}
          >
            Iniciar sesión
          </Link>
          <Link
            href={`/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`}
            style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}
          >
            Registrarse
          </Link>
        </div>
      )}
    </main>
  );
}
