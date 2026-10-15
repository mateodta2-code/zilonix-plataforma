import { UserProfile } from "@clerk/nextjs";

// Ruta protegida (middleware.ts la bloquea sin sesión). UserProfile es
// el componente de Clerk para administrar la cuenta — ahí mismo, en
// "Security", está la opción para activar 2FA (app autenticadora),
// sin tener que construir esa pantalla a mano.
export default function CuentaPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "48px 24px" }}>
      <UserProfile />
    </main>
  );
}
