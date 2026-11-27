import { SignUp } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";

// Registro PROPIO de la bodega (mismo marco que su login). Crea la cuenta de
// Clerk (correo y código) y sigue en /bodega/crear, donde se nombra la
// bodega y su primera sede. La misma cuenta puede ser además vendedor o
// domiciliario: cada papel con su URL.
export default function RegistroBodegaPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "64px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Registra tu bodega</h1>
      <SignUp routing="path" path="/bodega/registro" signInUrl="/bodega/iniciar-sesion" forceRedirectUrl="/bodega/crear" appearance={aparienciaClerk} />
    </main>
  );
}
