import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "./page.module.css";

// Tarea feat-ui-acceso — portada pública: logo oficial, una frase
// corta y los dos botones de acceso. Sin textos inventados de precios
// ni de clientes (no hay ninguno real todavía). La versión ya se ve en
// el pie de página global (app/layout.tsx) — no hace falta repetirla
// acá.
export default async function HomePage() {
  // Tarea 1.6 — a dónde manda esta pantalla a alguien que ya inició
  // sesión depende de si ya tiene una empresa o no. obtenerOCrearUsuarioActual()
  // devuelve null sola para un visitante sin sesión (no pega contra la
  // base), así que es segura de llamar acá siempre.
  const usuario = await obtenerOCrearUsuarioActual();
  const empresas = usuario ? await listarEmpresasDeUsuario(usuario.id) : [];

  return (
    <main className={styles.portada}>
      {/* SVG oficial del manual de marca, nunca redibujado — mismo
          criterio que el logo de la barra lateral (feat-ui-marca):
          mínimo 260px de ancho, sin estirar, rotar, recolorear ni
          sombra/brillo. Plata sobre blanco permitido en los dos
          temas para el logo completo. */}
      <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" className={styles.logo} width={260} height={94} />

      <SignedOut>
        <p className={styles.lema}>Gestiona tus ventas en Mercado Libre en un solo lugar.</p>
        <div className={styles.botones}>
          <Link href="/sign-in" className={styles.botonSecundario}>
            Iniciar sesión
          </Link>
          <Link href="/sign-up" className={styles.botonPrimario}>
            Crear cuenta
          </Link>
        </div>
      </SignedOut>

      <SignedIn>
        <div className={styles.sesionActiva}>
          <UserButton afterSignOutUrl="/" />
          <Link href="/cuenta" className={styles.enlaceSesion}>
            Ver mi cuenta
          </Link>
          {empresas.length > 0 ? (
            <Link href="/panel" className={styles.botonPrimario}>
              Ir al panel
            </Link>
          ) : (
            <Link href="/crear-empresa" className={styles.botonPrimario}>
              Crear mi empresa
            </Link>
          )}
        </div>
      </SignedIn>
    </main>
  );
}
