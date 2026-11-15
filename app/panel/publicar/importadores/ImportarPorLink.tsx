"use client";

import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { buscarImportacionPorLinkAction } from "./actions";
import { mensajeErrorImportarLink } from "./mensajes-error";

// Issue #44 (anexo) — "Traer datos de ese link" con CUALQUIER link de
// Mercado Libre (incluidos catálogo /p/, /up/ y links cortos meli.la),
// con la extensión instalada: extension/background.js abre esa
// publicación en una pestaña de fondo, la lee, la cierra, y manda el
// resultado de vuelta con el MISMO postMessage "importar-publicar" que
// ya usa el botón "Importar a Publicar" del panel flotante —
// PaginaPublicar.tsx ya lo escucha y llena el formulario (ver ese
// archivo, el efecto de arriba) — este componente no repite esa
// hidratación, SOLO reacciona para limpiar su propio "Leyendo…" y
// mostrar un error puntual si algo falla (`importar-link-error`,
// nuevo). Nunca confía ciegamente en el mensaje que llega — el mismo
// payload que trae "importar-publicar" vuelve a pasar por
// itemImportadoDesdeMensajeExtension del lado de PaginaPublicar.tsx,
// sin cambios acá.
//
// Sin la extensión instalada: el form sigue enviándose IGUAL que
// siempre (buscarImportacionPorLinkAction, la API oficial de Mercado
// Libre) — nunca se rompe ese camino, nunca se bloquea el submit sin
// la extensión. La detección es la MISMA técnica que InsigniaExtension.tsx
// (issue #197): un atributo que extension/marcador-zilonix.js pone en
// <html> SOLO cuando corre sobre esta app.
const RAZON_A_MENSAJE: Record<string, string> = {
  dominio_no_permitido: "Ese link no parece ser de Mercado Libre — pegá el link completo de la publicación.",
  no_es_mercadolibre: "Ese link terminó llevando a otro sitio, no a Mercado Libre.",
  captcha: 'Mercado Libre pidió verificación — abrí el link vos mismo en una pestaña y usá el botón "Importar a Publicar" del panel de la extensión.',
  timeout: "Mercado Libre tardó demasiado en responder — intentá de nuevo.",
  vacio: 'No se pudo leer ningún dato de esa publicación — probá abrirla vos mismo y usar "Importar a Publicar".',
  no_se_pudo_abrir: "No se pudo abrir esa pestaña — intentá de nuevo.",
};

function mensajeErrorImportarLinkExtension(razon: string | undefined): string {
  return (razon && RAZON_A_MENSAJE[razon]) || "No se pudo traer esa publicación — intentá de nuevo.";
}

type EstadoExtension = "inactivo" | "leyendo" | "error";

export function ImportarPorLink({
  linkError,
  noDisponible,
  importado,
}: {
  linkError: string;
  noDisponible: boolean;
  importado: boolean;
}) {
  const [estado, setEstado] = useState<EstadoExtension>("inactivo");
  const [errorExtension, setErrorExtension] = useState("");

  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.source !== window || evento.origin !== window.location.origin) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: { razon?: string } } | null;
      if (!datos || datos.fuente !== "zilonix-extension") return;
      if (datos.tipo === "importar-publicar") {
        // La hidratación del formulario la hace PaginaPublicar.tsx (su
        // propio listener, sin cambios) — acá solo se limpia el estado
        // de "Leyendo…" de ESTE botón.
        setEstado("inactivo");
        setErrorExtension("");
      } else if (datos.tipo === "importar-link-error") {
        setEstado("error");
        setErrorExtension(mensajeErrorImportarLinkExtension(datos.payload?.razon));
      }
    }
    window.addEventListener("message", alRecibirMensaje);
    return () => window.removeEventListener("message", alRecibirMensaje);
  }, []);

  function alEnviar(evento: React.FormEvent<HTMLFormElement>) {
    const conExtension = typeof document !== "undefined" && document.documentElement.hasAttribute("data-zilonix-extension");
    if (!conExtension) return; // sin extensión: el form sigue su envío normal, el camino de la API de siempre

    const link = (new FormData(evento.currentTarget).get("link") as string | null)?.trim() ?? "";
    if (!link) return; // campo vacío: deja que la validación normal del <input required> lo maneje

    // Clic real de la persona — SOLO acá se le pide a la extensión que
    // abra algo, nunca antes, nunca sin este submit.
    evento.preventDefault();
    setEstado("leyendo");
    setErrorExtension("");
    window.postMessage({ fuente: "zilonix-panel", tipo: "importar-link", payload: { link } }, window.location.origin);
  }

  const mensajeError = mensajeErrorImportarLink(linkError || undefined);

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>
        Pegá el link de cualquier publicación de Mercado Libre (propia o de la competencia, incluido un link de catálogo "/p/" o uno corto
        "meli.la") para traer sus datos como base — todavía no publica nada. Con la extensión de Zilonix instalada, la trae leyendo la página
        directamente; si no, lo intenta por la API oficial de Mercado Libre.
      </p>
      <form action={buscarImportacionPorLinkAction} onSubmit={alEnviar} style={{ marginTop: 12 }}>
        <Campo etiqueta="Link de la publicación">
          {/* Issue #315 — ejemplo genérico (no solo Colombia): la
          validación real de dominio (extension/background.js,
          DOMINIOS_ML_PAIS) ya acepta mercadolibre.com.{co,mx,ar,...} de
          cualquier país, esto es solo el texto de ayuda. */}
          <input name="link" type="url" placeholder="https://articulo.mercadolibre.com.{co,mx,ar...}/..." required className="zx-control" />
        </Campo>
        <Boton type="submit" variante="secundario" chico style={{ marginTop: 8 }} disabled={estado === "leyendo"}>
          {estado === "leyendo" ? "Leyendo la publicación…" : "Traer datos de ese link"}
        </Boton>
      </form>

      {estado === "error" && errorExtension && (
        <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{errorExtension}</p>
      )}
      {mensajeError && <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{mensajeError}</p>}
      {noDisponible && (
        <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>
          Mercado Libre no deja traer esa publicación completa por la API (pasa seguido con publicaciones ajenas, o con links de catálogo) —
          instalá la extensión de Zilonix para traerla directo de la página, o usá el bookmarklet de la sección de abajo.
        </p>
      )}
      {importado && <p style={{ marginTop: 12, color: "var(--kpi-exito-texto)", fontSize: 14 }}>Se importó — revisá el formulario de arriba.</p>}
    </>
  );
}
