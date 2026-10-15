import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { VERSION } from "@/lib/version";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

export default async function HomePage() {
  // Tarea 1.6 — a dónde manda esta pantalla a alguien que ya inició
  // sesión depende de si ya tiene una empresa o no. obtenerOCrearUsuarioActual()
  // devuelve null sola para un visitante sin sesión (no pega contra la
  // base), así que es segura de llamar acá siempre.
  const usuario = await obtenerOCrearUsuarioActual();
  const empresas = usuario ? await listarEmpresasDeUsuario(usuario.id) : [];

  return (
    <main style={{ padding: "48px 24px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Zilonix</h1>
      <p style={{ opacity: 0.7 }}>
        Plataforma en construcción — tarea 1.6 del plan técnico (empresas y cambio de empresa). Versión {VERSION}.
      </p>

      <SignedOut>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link href="/sign-in" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Iniciar sesión
          </Link>
          <Link href="/sign-up" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Registrarse
          </Link>
        </div>
      </SignedOut>

      <SignedIn>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
          <UserButton afterSignOutUrl="/" />
          <Link href="/cuenta" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Ver mi cuenta
          </Link>
          {empresas.length > 0 ? (
            <Link href="/panel" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
              Ir al panel
            </Link>
          ) : (
            <Link
              href="/crear-empresa"
              style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}
            >
              Crear mi empresa
            </Link>
          )}
        </div>
      </SignedIn>
    </main>
  );
}
