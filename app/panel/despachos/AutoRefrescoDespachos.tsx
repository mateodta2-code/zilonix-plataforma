"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 60_000;

// Issue "despachos no aparecen solos" (Refs #49) — vuelve a pedir la
// página (Server Component: listarTarjetasDespacho vuelve a leer la
// base, nunca llama a Mercado Libre) cada INTERVALO_MS mientras la
// pestaña está visible. Pausado con document.hidden: una pestaña en
// segundo plano no gasta ciclos ni interrumpe al usuario a medio
// imprimir o marcar un despacho en otra pestaña del navegador.
export function AutoRefrescoDespachos() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
