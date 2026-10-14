import { VERSION } from "@/lib/version";

export default function HomePage() {
  return (
    <main style={{ padding: "48px 24px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Zilonix</h1>
      <p style={{ opacity: 0.7 }}>
        Plataforma en construcción — tarea 1.1 del plan técnico. Versión {VERSION}.
      </p>
    </main>
  );
}
