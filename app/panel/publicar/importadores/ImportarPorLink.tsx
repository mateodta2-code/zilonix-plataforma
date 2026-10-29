"use client";

import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { buscarImportacionPorLinkAction } from "./actions";
import { mensajeErrorImportarLink } from "./mensajes-error";

// Parte 3, punto A.2 — "Importar publicación desde un link": el id se
// interpreta en el servidor (idItemDesdeLinkMl, puro) y se pide por la
// API OFICIAL, nunca scrapeando la página — si Mercado Libre responde
// 403/404 (típico de una publicación AJENA, que la API no deja leer
// completa para otro vendedor) se manda a usar el bookmarklet o el
// botón de la extensión en su lugar, nunca se reintenta scrapeando.
export function ImportarPorLink({
  linkError,
  noDisponible,
  importado,
}: {
  linkError: string;
  noDisponible: boolean;
  importado: boolean;
}) {
  const mensajeError = mensajeErrorImportarLink(linkError || undefined);

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>
        Pegá el link de cualquier publicación de Mercado Libre (propia o de la competencia) para traer sus datos como base — todavía no
        publica nada. Solo funciona si Mercado Libre deja leer esa publicación por su API oficial; si no, usá el botón de la extensión o el
        bookmarklet de abajo, que sí la pueden leer desde tu propio navegador.
      </p>
      <form action={buscarImportacionPorLinkAction} style={{ marginTop: 12 }}>
        <Campo etiqueta="Link de la publicación">
          <input name="link" type="url" placeholder="https://articulo.mercadolibre.com.co/MCO-..." required className="zx-control" />
        </Campo>
        <Boton type="submit" variante="secundario" chico style={{ marginTop: 8 }}>
          Traer datos de ese link
        </Boton>
      </form>

      {mensajeError && <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{mensajeError}</p>}
      {noDisponible && (
        <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>
          Mercado Libre no deja traer esa publicación completa por la API (pasa seguido con publicaciones ajenas) — usá el botón "Importar a
          Publicar" de la extensión de Zilonix mientras la tenés abierta, o el bookmarklet de la sección de abajo.
        </p>
      )}
      {importado && <p style={{ marginTop: 12, color: "var(--kpi-exito-texto)", fontSize: 14 }}>Se importó — revisá el formulario de arriba.</p>}
    </>
  );
}
