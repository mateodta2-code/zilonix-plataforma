"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast, type ItemToast } from "@/components/marco/Toast";
import {
  guardarDatoPaginaSeguimientoAction,
  guardarVariosDatosPaginaSeguimientoAction,
  type ResultadoGuardadoExtension,
} from "./actions";

// Refs #175 — bug reportado: un guardado de la extensión que fallaba
// (sin cuenta/permiso, payload inválido) no dejaba NINGÚN rastro en
// pantalla — la fila simplemente se quedaba en "Sin dato" para
// siempre, sin pista de por qué. Un mensaje por motivo, en vez de uno
// genérico, para que la persona sepa si tiene que volver a iniciar
// sesión, pedir un permiso, o si fue solo ruido inofensivo (un item
// viejo de la cola que ya no está en seguimiento).
type MotivoFallo = Exclude<ResultadoGuardadoExtension, { ok: true }>["motivo"];

const MENSAJE_DE_MOTIVO: Record<MotivoFallo, string> = {
  payload_invalido: "La extensión mandó un dato con un formato que no se pudo leer — probá recargar la página de Mercado Libre.",
  sin_sesion: "Tu sesión no está activa — iniciá sesión de nuevo para que la extensión pueda guardar lo que lee.",
  sin_empresa: "No se encontró tu empresa activa — recargá el panel e intentá de nuevo.",
  sin_permiso: "No tenés permiso para actualizar seguimientos — pedí el permiso de modificar inventario.",
  seguimiento_inactivo: "Esa página ya no corresponde a un seguimiento activo — se ignoró.",
  tipo_no_coincide: "El tipo de página no coincide con el seguimiento guardado — se ignoró.",
};

// Las fallas de LOTE (cola de visitas encoladas) nunca avisan por un
// item viejo puntual (eso ya se loguea del lado del servidor, ver
// actions.ts) — solo por algo que impidió guardar el lote entero.
const MOTIVOS_DE_LOTE_PARA_AVISAR = new Set<MotivoFallo>(["sin_sesion", "sin_empresa", "sin_permiso"]);

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
// Guarda con la Server Action (que revalida sesión/permiso/empresa
// SIEMPRE del lado del servidor, nunca confía en nada del mensaje más
// que el payload) y pide un refresh de la página — si el guardado de
// verdad escribió algo nuevo, el usuario lo ve en la tabla en el
// próximo render. Refs #175 — antes, si el guardado fallaba (sin
// cuenta/permiso, payload inválido) el refresh no cambiaba nada y la
// persona nunca se enteraba por qué; ahora un fallo real (no un item
// viejo puntual, ver MOTIVOS_DE_LOTE_PARA_AVISAR) muestra un Toast.
export function EscuchaExtension() {
  const router = useRouter();
  const [toasts, setToasts] = useState<ItemToast[]>([]);

  function avisar(texto: string) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((actual) => [...actual, { id, texto, estado: "peligro" }]);
    setTimeout(() => setToasts((actual) => actual.filter((t) => t.id !== id)), 8000);
  }
  function cerrarToast(id: string) {
    setToasts((actual) => actual.filter((t) => t.id !== id));
  }

  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== window) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension") return;
      if (datos.tipo === "dato-pagina-seguimiento") {
        void guardarDatoPaginaSeguimientoAction(datos.payload).then((resultado) => {
          if (!resultado.ok) avisar(MENSAJE_DE_MOTIVO[resultado.motivo]);
          router.refresh();
        });
        return;
      }
      // Issue #251 (corrección de Pablo, punto 7) — "vacía la cola en
      // lote: una sola Server Action y un solo router.refresh()": antes,
      // cada lectura encolada que background.js reenviaba (una por una)
      // disparaba su PROPIA llamada y su PROPIO refresh — con una cola
      // de varias lecturas, eso eran varios refetches completos de la
      // página, uno detrás del otro. Ahora background.js manda toda la
      // cola en un solo mensaje ("cola-seguimiento", `{payloads: [...]}`).
      if (datos.tipo === "cola-seguimiento") {
        const payloads = (datos.payload as { payloads?: unknown } | null)?.payloads;
        if (Array.isArray(payloads) && payloads.length > 0) {
          void guardarVariosDatosPaginaSeguimientoAction(payloads).then((resultado) => {
            if (!resultado.ok && MOTIVOS_DE_LOTE_PARA_AVISAR.has(resultado.motivo)) {
              avisar(MENSAJE_DE_MOTIVO[resultado.motivo]);
            }
            router.refresh();
          });
        }
      }
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

  return <Toast items={toasts} onCerrar={cerrarToast} />;
}
