"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";

// Issue #251, punto 9 — "Actualizar todo": mismo click-gate que ya usa
// "Completar vendidos" de Investigación (PanelInvestigacion.tsx,
// completarVendidosBloque) — un clic real abre cada link en una
// pestaña nueva con window.open. Nunca "noopener"/"noreferrer" ahí: por
// estándar de HTML, con esas features el navegador SIEMPRE devuelve
// null sin importar si de verdad se abrió — se abre sin ninguna y se
// le quita `opener` a mano (corrección de Pablo, issue #211). La
// extensión lee cada página al cargar (content.js/reescanear(), mismo
// disparador que ya usa abrir la ficha/tienda a mano) — este botón
// nunca hace que la extensión navegue sola, solo abre las pestañas que
// la persona ya decidió abrir con este clic.
//
// Las pestañas quedan abiertas (mismo alcance que "Completar vendidos"
// hoy) — cerrarlas solas después de leer queda pendiente, necesitaría
// un marcador nuevo en la URL + lógica en content.js que esta vuelta
// no construye.
export function BotonActualizarTodo({ links }: { links: string[] }) {
  const [yaAbrio, setYaAbrio] = useState(false);

  if (links.length === 0) return null;

  function actualizarTodo() {
    for (const link of links) {
      const ventana = window.open(link, "_blank");
      if (ventana) ventana.opener = null;
    }
    setYaAbrio(true);
  }

  return (
    <Boton type="button" variante="secundario" chico onClick={actualizarTodo}>
      {yaAbrio ? `Actualizar todo de nuevo (${links.length})` : `Actualizar todo (${links.length})`}
    </Boton>
  );
}
