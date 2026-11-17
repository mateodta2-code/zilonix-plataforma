"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const INTERVALO_REFRESCO_MS = 5000;

// Refresca los datos del servidor cada 5 s MIENTRAS esté montado. Sustituye
// al <meta http-equiv="refresh">: ese temporizador del navegador sobrevivía
// a la navegación del router de Next y devolvía al usuario a
// /panel/conectar-ml a los 5 s aunque ya estuviera en otro módulo. Acá el
// intervalo se limpia al desmontar (salir de la página) y la página de
// servidor solo lo pinta mientras hay una importación en curso, así que al
// terminar deja de existir y de refrescar.
export function RefrescarImportacion() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), INTERVALO_REFRESCO_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
