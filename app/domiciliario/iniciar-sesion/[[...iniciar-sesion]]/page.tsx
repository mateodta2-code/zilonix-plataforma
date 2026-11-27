import { SignIn } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";

// Login APARTE del de vendedores (mismas cuentas de Clerk, solo correo —
// no activa SMS ni nada de pago). Quien no tiene cuenta se registra en
// /domiciliario/registro. Con ?redirect_url (viene de la invitación)
// vuelve allá; si no, al panel.
export default function IniciarSesionDomiciliarioPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px" }}>
      <SignIn
        routing="path"
        path="/domiciliario/iniciar-sesion"
        fallbackRedirectUrl="/domiciliario"
        signUpUrl="/domiciliario/registro"
        appearance={{ ...aparienciaClerk, elements: { ...(aparienciaClerk as { elements?: object }).elements, footer: { display: "none" } } }}
      />
      <p style={{ marginTop: 16, fontSize: 14 }}>
        <a href="/domiciliario/registro" style={{ textDecoration: "underline" }}>
          ¿No tienes cuenta? Regístrate como domiciliario
        </a>
      </p>
    </main>
  );
}
