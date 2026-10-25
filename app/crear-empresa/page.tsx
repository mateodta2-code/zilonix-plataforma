import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "../page.module.css";
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
      {/* Mismo SVG oficial que la portada (app/page.tsx) y la barra
          lateral: nunca redibujado, 260px vía .logo, sin estirar,
          rotar, recolorear ni sombra/brillo. Esta columna no es
          .portada, así que el margen lo centra y deja el mismo aire
          (32px) que el gap de esa pantalla. */}
      <img
        src="/marca/zilonix-seller-logo.svg"
        alt="Zilonix Seller"
        className={styles.logo}
        width={260}
        height={94}
        style={{ margin: "0 auto 32px" }}
      />
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
