"use client";

import { Boton } from "@/components/marco/Boton";

export default function InvitacionError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>No se pudo aceptar la invitación</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>{error.message}</p>
      <Boton onClick={() => reset()} style={{ marginTop: 16 }}>
        Volver a intentar
      </Boton>
    </main>
  );
}
