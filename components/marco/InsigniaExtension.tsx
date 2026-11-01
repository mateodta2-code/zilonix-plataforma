"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/marco/Chip";

// Issue #197 — detecta si la extensión de Zilonix está instalada:
// extension/marcador-zilonix.js pone un atributo en <html> SOLO
// cuando corre sobre esta misma app (nunca sobre un marketplace) —
// técnica estándar de detección de extensión por una web propia, sin
// mensajes ni permisos especiales. Con extensión, se puede abrir cada
// candidato en Mercado Libre para ver datos reales actualizados al
// momento (incluida la cobertura de Amazon/Temu/etc. — issue #197,
// punto 7); sin ella, esta pantalla sigue funcionando solo con lo que
// la API oficial de Mercado Libre ya puede confirmar.
export function InsigniaExtension() {
  const [conExtension, setConExtension] = useState<boolean | null>(null);

  useEffect(() => {
    setConExtension(document.documentElement.hasAttribute("data-zilonix-extension"));
  }, []);

  // null = todavía no se confirmó (primer render, antes del efecto) —
  // nunca se adivina un estado antes de poder comprobarlo de verdad.
  if (conExtension === null) return null;
  return conExtension ? <Chip estado="exito">Extensión conectada — cobertura real</Chip> : <Chip>Sin extensión — solo API</Chip>;
}
