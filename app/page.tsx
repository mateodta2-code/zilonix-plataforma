import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { VERSION } from "@/lib/version";

export default function HomePage() {
  return (
    <main style={{ padding: "48px 24px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Zilonix</h1>
      <p style={{ opacity: 0.7 }}>
        Plataforma en construcción — tarea 1.5 del plan técnico (login con Clerk). Versión {VERSION}.
      </p>

      <SignedOut>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link href="/sign-in" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Iniciar sesión
          </Link>
          <Link href="/sign-up" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Registrarse
          </Link>
        </div>
      </SignedOut>

      <SignedIn>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
          <UserButton afterSignOutUrl="/" />
          <Link href="/cuenta" style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}>
            Ver mi cuenta
          </Link>
        </div>
      </SignedIn>
    </main>
  );
}
