import { redirect } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { listarMembresiasDeUsuario } from "@/lib/bodega/miembros";
import { tienePerfilDomiciliario } from "@/lib/bodega/perfil-domiciliario";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { crearPerfilDomiciliarioAction } from "./actions";

export const dynamic = "force-dynamic";

// Segundo paso del autorregistro. Tener empresa de vendedor o ser admin u
// operario de una bodega NO bloquea: solo se redirige si ya tiene perfil o
// ya es domiciliario activo de alguna bodega.
export default async function CrearPerfilDomiciliarioPage({ searchParams }: { searchParams: { error?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/domiciliario/iniciar-sesion");

  const [membresias, tienePerfil] = await Promise.all([listarMembresiasDeUsuario(usuario.id), tienePerfilDomiciliario(usuario.id)]);
  if (tienePerfil || membresias.some((m) => m.rol === "domiciliario" && m.activo)) redirect("/domiciliario");

  const campo = { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" } as const;
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Crea tu perfil de domiciliario</h1>
      <p style={{ opacity: 0.7, fontSize: 14, lineHeight: 1.5 }}>
        Con este perfil las bodegas podrán invitarte con tu correo ({usuario.email}). Solo el nombre es obligatorio.
      </p>
      {searchParams.error ? (
        <p role="alert" style={{ fontSize: 13 }}>
          {searchParams.error}
        </p>
      ) : null}
      <form action={crearPerfilDomiciliarioAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <label style={{ fontSize: 13 }}>
          Nombre
          <input name="nombre" required maxLength={120} defaultValue={usuario.nombre} style={campo} />
        </label>
        <label style={{ fontSize: 13 }}>
          Teléfono (opcional)
          <input name="telefono" type="tel" maxLength={30} style={campo} />
        </label>
        <label style={{ fontSize: 13 }}>
          Ciudad (opcional)
          <input name="ciudad" maxLength={80} style={campo} />
        </label>
        <Boton type="submit" style={{ marginTop: 8 }}>
          Crear perfil
        </Boton>
      </form>
    </main>
  );
}
