import { redirect } from "next/navigation";
import { SignedOut } from "@clerk/nextjs";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import Encabezado from "@/components/portada/Encabezado";
import Hero from "@/components/portada/Hero";
import Problema from "@/components/portada/Problema";
import Modulos from "@/components/portada/Modulos";
import ComoFunciona from "@/components/portada/ComoFunciona";
import Capturas from "@/components/portada/Capturas";
import Planes from "@/components/portada/Planes";
import Garantia from "@/components/portada/Garantia";
import Faq from "@/components/portada/Faq";
import LlamadoFinal from "@/components/portada/LlamadoFinal";
import Pie from "@/components/portada/Pie";
import styles from "@/components/portada/Portada.module.css";
// Testimonios: desactivada hasta tener testimonios reales (mismo
// criterio que zilonix-seller-web — sin ese componente acá a
// propósito).

// Tarea feat-portada-pagina-venta — la página de venta de Zilonix
// Seller (antes en zilonix-seller-web, ahora dentro de la plataforma)
// vive en "/" para quien no tiene sesión. Con sesión, "/" sigue
// redirigiendo a /panel en el servidor (tarea fix-login-directo-panel,
// sin tocar esa lógica).
export default async function HomePage({ searchParams }: { searchParams: { salida?: string } }) {
  // Tarea fix-login-directo-panel — con sesión, "/" nunca se pinta:
  // redirect server-side antes de cualquier render (sin parpadeo).
  // obtenerOCrearUsuarioActual() devuelve null sola para un visitante
  // sin sesión (no pega contra la base), así que es segura de llamar
  // acá siempre. El destino final (/panel o /crear-empresa si la
  // empresa no existe todavía, /sign-in si por algo la sesión no
  // resultó válida) lo decide /panel mismo — lib/panel-contexto.ts,
  // misma lógica de siempre, no se duplica acá.
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
    <SignedOut>
      {avisoSalida && <p className={styles.avisoSalida}>{avisoSalida}</p>}
      <Encabezado />
      <main>
        <Hero />
        <Problema />
        <Modulos />
        <ComoFunciona />
        <Capturas />
        <Planes />
        <Garantia />
        <Faq />
        <LlamadoFinal />
      </main>
      <Pie />
    </SignedOut>
  );
}
