"use client";

export default function RolesError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    // div, no <main> — esto ya renderiza adentro del <main> del marco
    // (app/panel/layout.tsx); un <main> anidado sería inválido.
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>No se pudo guardar</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>{error.message}</p>
      <button onClick={() => reset()} style={{ padding: "10px 16px", marginTop: 16 }}>
        Volver a intentar
      </button>
    </div>
  );
}
