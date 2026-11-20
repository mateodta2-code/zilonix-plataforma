import { Boton } from "@/components/marco/Boton";
import Link from "next/link";
import { obtenerInvitacionBodegaPorToken } from "@/lib/bodega/invitaciones";
import { NOMBRE_ROL_BODEGA } from "@/lib/bodega/roles";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { aceptarInvitacionBodegaAction } from "./actions";

const caja = { maxWidth: 420, margin: "0 auto", padding: "48px 24px" } as const;

// Ruta pública (lib/rutas-publicas.ts): el token en la URL es el permiso
// real. Sin sesión se ofrece entrar o registrarse y volver acá.
export default async function InvitacionBodegaPage({ params, searchParams }: { params: { token: string }; searchParams: { error?: string } }) {
  const invitacion = await obtenerInvitacionBodegaPorToken(params.token);

  if (!invitacion) {
    return (
      <main style={caja}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Invitación no encontrada</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>Revisa que copiaste el link completo.</p>
      </main>
    );
  }
  if (invitacion.estado === "vencida") {
    return (
      <main style={caja}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Esta invitación venció</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>Pídele a quien te invitó que te mande una nueva.</p>
      </main>
    );
  }
  const panel = invitacion.rol === "domiciliario" ? "domiciliario" : "bodega";
  if (invitacion.estado === "usada") {
    return (
      <main style={caja}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Esta invitación ya fue usada</h1>
        <Link href={`/${panel}`}>Ir al panel</Link>
      </main>
    );
  }

  const usuario = await obtenerOCrearUsuarioActual();
  const redirectUrl = `/invitacion-bodega/${params.token}`;

  return (
    <main style={caja}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Te invitaron a {invitacion.bodegaNombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Como <b>{NOMBRE_ROL_BODEGA[invitacion.rol]}</b>, para {invitacion.email}.
      </p>
      {searchParams.error && <p style={{ fontSize: 14 }}>{searchParams.error}</p>}

      {usuario ? (
        <form action={aceptarInvitacionBodegaAction} style={{ marginTop: 24 }}>
          <input type="hidden" name="token" value={params.token} />
          <Boton type="submit">
            Aceptar y entrar a {invitacion.bodegaNombre}
          </Boton>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link href={`/${panel}/iniciar-sesion?redirect_url=${encodeURIComponent(redirectUrl)}`} style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Iniciar sesión
          </Link>
          <Link href={`/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`} style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Registrarse
          </Link>
        </div>
      )}
    </main>
  );
}
