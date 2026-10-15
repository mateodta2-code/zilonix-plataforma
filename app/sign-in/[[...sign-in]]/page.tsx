import { SignIn } from "@clerk/nextjs";

// Componente ya hecho de Clerk (decisión D3) — registro, login, 2FA,
// verificación de correo, recuperación de acceso y límite de intentos
// vienen resueltos acá, no se arman a mano.
export default function SignInPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "48px 24px" }}>
      <SignIn />
    </main>
  );
}
