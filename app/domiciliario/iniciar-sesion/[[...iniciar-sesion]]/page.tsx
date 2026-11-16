import { SignIn } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";

// Login APARTE del de vendedores (mismas cuentas de Clerk, solo correo —
// no activa SMS ni nada de pago). Sin enlace a registro: quien no tiene
// cuenta entra por la invitación (/invitacion-bodega/[token]). Con
// ?redirect_url (viene de la invitación) vuelve allá; si no, al panel.
export default function IniciarSesionDomiciliarioPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "64px 24px" }}>
      <SignIn
        routing="path"
        path="/domiciliario/iniciar-sesion"
        fallbackRedirectUrl="/domiciliario"
        signUpUrl="/domiciliario/iniciar-sesion"
        appearance={{ ...aparienciaClerk, elements: { ...(aparienciaClerk as { elements?: object }).elements, footer: { display: "none" } } }}
      />
    </main>
  );
}
