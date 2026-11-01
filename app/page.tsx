import Link from "next/link";
import { redirect } from "next/navigation";
import { SignedOut } from "@clerk/nextjs";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "./page.module.css";

// Tarea feat-ui-acceso — portada pública: logo oficial, una frase
// corta y los dos botones de acceso. Sin textos inventados de precios
// ni de clientes (no hay ninguno real todavía). La versión ya se ve en
// el pie de página global (app/layout.tsx) — no hace falta repetirla
// acá.
export default async function HomePage({ searchParams }: { searchParams: { salida?: string } }) {
  // Tarea fix-login-directo-panel — con sesión, "/" nunca se pinta:
  // redirect server-side antes de cualquier render (sin parpadeo de los
  // botones "Ver mi cuenta"/"Ir al panel" que había antes). obtenerOCrearUsuarioActual()
  // devuelve null sola para un visitante sin sesión (no pega contra la
  // base), así que es segura de llamar acá siempre. El destino final
  // (/panel o /crear-empresa si la empresa no existe todavía, /sign-in
  // si por algo la sesión no resultó válida) lo decide /panel mismo —
  // lib/panel-contexto.ts, misma lógica de siempre, no se duplica acá.
  const usuario = await obtenerOCrearUsuarioActual();
  if (usuario) redirect("/panel");

  // Issue #318 (review 5725541731) — destino del signOut que dispara
  // PaginaMisDatos tras borrar la cuenta propia (app/panel/mis-datos/
  // PaginaMisDatos.tsx): para entonces la sesión de Clerk ya está
  // cerrada, así que el aviso tiene que vivir en una ruta pública.
  const avisoSalida =
    searchParams.salida === "cuenta-borrada"
      ? "Tu cuenta quedó anonimizada y tu acceso fue borrado."
      : searchParams.salida === "cuenta-borrada-soporte"
        ? "Tus datos quedaron anonimizados, pero no se pudo cerrar tu acceso en Clerk — ya quedó registrado el error, escríbenos a soporte."
        : null;

  return (
    <main className={styles.portada}>
      {/* SVG oficial del manual de marca, nunca redibujado — mismo
          criterio que el logo de la barra lateral (feat-ui-marca):
          mínimo 260px de ancho, sin estirar, rotar, recolorear ni
          sombra/brillo. Plata sobre blanco permitido en los dos
          temas para el logo completo. */}
      <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" className={styles.logo} width={260} height={94} />

      {avisoSalida && <p style={{ fontSize: 14, color: "var(--texto-suave)", maxWidth: 440 }}>{avisoSalida}</p>}

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
    </main>
  );
}
