"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";

// Issue #251, punto 9 — "Actualizar todo": un clic real abre cada
// link de un competidor en una pestaña nueva. La extensión lee cada
// página al cargar (content.js/reescanear(), mismo disparador que ya
// usa abrir la ficha/tienda a mano) — este botón nunca hace que la
// extensión navegue sola, solo abre las pestañas que la persona ya
// decidió abrir con este clic.
//
// Corrección de Pablo — bug real: `window.open()` en bucle (el diseño
// original) lo bloquea el popup-blocker de Chrome después del primero
// o segundo, aunque venga de un clic real — con 5-10 competidores,
// la mayoría de las pestañas nunca se abrían. Ahora el clic manda los
// links por postMessage (marcador-zilonix.js los reenvía a
// background.js, que SÍ puede abrir pestañas con chrome.tabs.create
// sin que el popup-blocker lo toque) — background.js vuelve a aplicar
// su propio tope de 10 y su propio allowlist de dominio (nunca confía
// solo en el `.slice(0, 10)` de acá), así que esto es un mensaje, no
// una apertura directa.
//
// Las pestañas quedan abiertas (mismo alcance que "Completar vendidos"
// hoy) — cerrarlas solas después de leer queda pendiente, necesitaría
// un marcador nuevo en la URL + lógica en content.js que esta vuelta
// no construye.
const TOPE_SEGUIMIENTOS_ABRIR = 10;

export function BotonActualizarTodo({ links }: { links: string[] }) {
  const [yaAbrio, setYaAbrio] = useState(false);

  if (links.length === 0) return null;

  function actualizarTodo() {
    window.postMessage(
      { fuente: "zilonix-panel", tipo: "abrir-seguimientos", payload: { links: links.slice(0, TOPE_SEGUIMIENTOS_ABRIR) } },
      window.location.origin
    );
    setYaAbrio(true);
  }

  return (
    <Boton type="button" variante="secundario" chico onClick={actualizarTodo}>
      {yaAbrio ? `Actualizar todo de nuevo (${links.length})` : `Actualizar todo (${links.length})`}
    </Boton>
  );
}
