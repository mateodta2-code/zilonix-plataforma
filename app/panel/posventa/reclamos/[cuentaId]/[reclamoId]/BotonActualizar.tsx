"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Boton } from "@/components/marco/Boton";

// Vuelve a pedir el reclamo a Mercado Libre; sin auto-refresco.
export function BotonActualizar() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  return (
    <Boton variante="secundario" chico type="button" disabled={pendiente} onClick={() => iniciar(() => router.refresh())}>
      {pendiente ? "Actualizando…" : "Actualizar"}
    </Boton>
  );
}
