"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 5_000;

// Issue #569 — reemplaza el <meta http-equiv="refresh">, cuyo temporizador
// sobrevivía a la navegación del lado del cliente y devolvía al usuario a
// /panel/conectar-ml. Acá el intervalo se limpia al desmontarse.
export function ActualizarMientrasImporta() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
