import { SignUp } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";

// Registro PROPIO del domiciliario (misma cuenta de Clerk que las demás: una
// persona puede ser vendedor, bodega y domiciliario a la vez). Al terminar va
// a crear su perfil; luego espera la invitación de una bodega.
export default function RegistroDomiciliarioPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "64px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Regístrate como domiciliario</h1>
      <SignUp routing="path" path="/domiciliario/registro" signInUrl="/domiciliario/iniciar-sesion" forceRedirectUrl="/domiciliario/crear-perfil" appearance={aparienciaClerk} />
    </main>
  );
}
