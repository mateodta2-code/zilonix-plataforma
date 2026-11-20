"use client";

import { Boton } from "@/components/marco/Boton";

// Tarea 1.6 — límite de error propio para esta pantalla: sin esto, un
// error esperable (nombre vacío, NIT repetido) cae en la pantalla
// genérica de error de Next.js en vez de mostrarse como lo que es, un
// dato mal puesto que la persona puede corregir.
export default function CrearEmpresaError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>No se pudo crear la empresa</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>{error.message}</p>
      <Boton onClick={() => reset()} style={{ marginTop: 16 }}>
        Volver a intentar
      </Boton>
    </main>
  );
}
