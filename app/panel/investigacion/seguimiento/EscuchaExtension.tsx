"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { guardarDatoPaginaSeguimientoAction } from "./actions";

// Issue #251 — mismo puente que ya usa /panel/investigacion
// (PanelInvestigacion.tsx, "vendidos-completados"/"listado-importado"):
// extension/content.js lee inventario/vendidos de la ficha de un
// competidor, o publicaciones de una tienda seguida, cuando la
// persona ABRE esa página con un clic real (Mercado Libre no deja ver
// estos datos por la API para un recurso ajeno — confirmado en #250).
// extension/background.js lo reenvía a TODAS las pestañas abiertas;
// extension/marcador-zilonix.js (que solo corre en el dominio de esta
// app) lo traduce a este postMessage. Solo esta pantalla escucha
// "dato-pagina-seguimiento" — las otras páginas de la app lo ignoran
// sin romper nada.
//
// Nunca pinta nada por su cuenta: guarda con la Server Action (que
// revalida sesión/permiso/empresa SIEMPRE del lado del servidor,
// nunca confía en nada del mensaje más que el payload) y pide un
// refresh de la página — si el guardado de verdad escribió algo
// nuevo, el usuario lo ve en la tabla en el próximo render; si no
// (ej. todavía no hay foto de hoy, o el id no es un seguimiento
// activo), el refresh no cambia nada visible, tampoco rompe nada.
export function EscuchaExtension() {
  const router = useRouter();

  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== window) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension" || datos.tipo !== "dato-pagina-seguimiento") return;
      void guardarDatoPaginaSeguimientoAction(datos.payload).then(() => router.refresh());
    }

    window.addEventListener("message", alRecibirMensaje);

    // Issue #251 (revisión de Pablo, punto 4) — "que la lectura no
    // dependa de tener abierta la pestaña de Seguimiento": si la
    // persona visitó la ficha de un competidor mientras esta pantalla
    // estaba cerrada, extension/background.js lo guardó en una cola
    // (chrome.storage.session) en vez de perderlo. Al montar, se le
    // pide que la vacíe — marcador-zilonix.js reenvía cada lectura
    // encolada por el mismo canal de siempre ("dato-pagina-seguimiento",
    // arriba), así que este mismo listener las procesa igual.
    window.postMessage({ fuente: "zilonix-panel", tipo: "pedir-cola-seguimiento" }, window.location.origin);

    return () => window.removeEventListener("message", alRecibirMensaje);
  }, [router]);

  return null;
}
