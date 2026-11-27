import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";

// Login APARTE del de vendedores (mismas cuentas de Clerk, solo correo —
// no activa SMS ni nada de pago). Quien no tiene cuenta puede registrar su
// bodega (/bodega/registro) o entrar por invitación (/invitacion-bodega/[token]).
// Con ?redirect_url (viene de la invitación) vuelve allá; si no, al panel.
export default function IniciarSesionBodegaPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px" }}>
      <SignIn
        routing="path"
        path="/bodega/iniciar-sesion"
        fallbackRedirectUrl="/bodega"
        signUpUrl="/bodega/registro"
        appearance={{ ...aparienciaClerk, elements: { ...(aparienciaClerk as { elements?: object }).elements, footer: { display: "none" } } }}
      />
      {/* Enlace propio (el pie de Clerk sigue oculto). */}
      <p style={{ marginTop: 16, fontSize: 14 }}>
        ¿No tienes cuenta? <Link href="/bodega/registro">Registra tu bodega</Link>
      </p>
    </main>
  );
}
