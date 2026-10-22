import Link from "next/link";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { PRIVACIDAD_VERSION, QUE_VE_ZILONIX_VERSION, TERMINOS_VERSION } from "@/lib/legal";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { crearEmpresaAction } from "./actions";

// Tarea 1.6 — "crear empresa al registrarse". No es solo al registrarse
// en Clerk: también sirve para crear una empresa adicional más
// adelante, con el mismo formulario (D2: un usuario puede estar en
// varias empresas).
export default async function CrearEmpresaPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>
        {propias.length === 0 ? "Crea tu primera empresa" : "Crear otra empresa"}
      </h1>
      <p style={{ opacity: 0.7, fontSize: 14, lineHeight: 1.5 }}>
        Cada empresa es un NIT distinto (una empresa por NIT/sociedad). Si ya tienes otra empresa en
        Zilonix, esta queda completamente aparte — nunca comparten datos.
      </p>

      <form action={crearEmpresaAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <label style={{ fontSize: 13 }}>
          Nombre de la empresa
          <input
            name="nombre"
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          NIT
          <input
            name="nit"
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.45 }}>
          <input type="checkbox" name="aceptaTerminos" value="si" required style={{ marginTop: 3, flexShrink: 0 }} />
          <span>
            Acepto los <Link href="/terminos">términos y condiciones</Link> (versión {TERMINOS_VERSION}) y autorizo el
            tratamiento de mis datos personales según la <Link href="/privacidad">política de privacidad</Link>{" "}
            (versión {PRIVACIDAD_VERSION}). Leí <Link href="/que-ve-zilonix">qué ve el personal de Zilonix</Link>{" "}
            (versión {QUE_VE_ZILONIX_VERSION}).
          </span>
        </label>
        <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
          La casilla empieza desmarcada. Sin marcarla no se crea la empresa. Al crearla, la actividad de la empresa
          guarda estas versiones y la fecha.
        </p>
        <button type="submit" style={{ padding: "10px 16px", marginTop: 8 }}>
          Crear empresa
        </button>
      </form>

      {propias.length > 0 && (
        <ul style={{ marginTop: 32, fontSize: 13, opacity: 0.7, paddingLeft: 18 }}>
          {propias.map((e) => (
            <li key={e.id}>
              Ya tienes: {e.nombre} (NIT {e.nit})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
