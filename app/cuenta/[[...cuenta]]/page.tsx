import { UserProfile } from "@clerk/nextjs";

// Ruta protegida (middleware.ts la bloquea sin sesión). UserProfile es
// el componente de Clerk para administrar la cuenta — ahí mismo, en
// "Security", está la opción para activar 2FA (app autenticadora),
// sin tener que construir esa pantalla a mano.
//
// [[...cuenta]] (catch-all) a propósito: bug real encontrado en vivo
// (14/10/2026) — UserProfile navega internamente a subrutas propias
// (ej. /cuenta/security al hacer clic en "Security"), y con una ruta
// fija (app/cuenta/page.tsx, sin catch-all) esas subrutas daban 404.
// Mismo patrón que ya se usó bien en /sign-in y /sign-up.
export default function CuentaPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "48px 24px" }}>
      <UserProfile />
    </main>
  );
}
