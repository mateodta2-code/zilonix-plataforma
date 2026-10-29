"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { parseImportacionBookmarklet, type ItemImportado } from "../formulario-logica";
import { BOOKMARKLET_ZILONIX } from "./bookmarklet";

// Parte 3, punto A.3 — "Importar con el botón del navegador": corre
// ENTERO en el navegador de la persona (arrastra el link a la barra de
// marcadores, lo clickea viendo la publicación que quiere importar) —
// nunca es un scraper del servidor. Copia un JSON al portapapeles; acá
// solo se interpreta ese texto pegado (parseImportacionBookmarklet,
// puro, con sus propias pruebas) y se manda directo al formulario de
// arriba, sin ningún viaje al servidor — no hay ningún dato nuevo que
// Mercado Libre no le haya mostrado ya a la persona en su pantalla.
export function ImportarPorBookmarklet({ onImportar }: { onImportar: (item: ItemImportado) => void }) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importado, setImportado] = useState(false);

  function importar() {
    const item = parseImportacionBookmarklet(texto);
    if (!item) {
      setError("No se reconoció el texto pegado — copiá de nuevo usando el botón de abajo, sobre la publicación que querés importar.");
      setImportado(false);
      return;
    }
    setError(null);
    setImportado(true);
    onImportar(item);
  }

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>
        Arrastrá este botón a la barra de marcadores de tu navegador. Después, parado en la publicación de Mercado Libre que quieras
        importar (propia o de la competencia), hacé clic en el marcador — copia título, descripción, precio, dimensiones y las fotos reales
        de esa publicación al portapapeles. Pegalas abajo para precargar el formulario de arriba; todavía no publica nada.
      </p>
      <p style={{ marginTop: 10 }}>
        {/* javascript: real a propósito — así funciona un bookmarklet;
        nunca se ejecuta sola, solo cuando la persona la arrastra a sus
        marcadores y después la clickea ella misma. */}
        {/* eslint-disable-next-line react/jsx-no-script-url -- bookmarklet real, pensado para arrastrarse a la barra de marcadores */}
        <a href={BOOKMARKLET_ZILONIX} onClick={(e) => e.preventDefault()} className="zx-control" style={{ display: "inline-block", padding: "6px 14px", fontSize: 13, cursor: "grab", textDecoration: "none" }}>
          📥 Importar a Zilonix
        </a>
      </p>
      <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 4 }}>(El clic de arriba no hace nada — es para arrastrarlo, no para apretarlo.)</p>

      <div style={{ marginTop: 14 }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pegá acá el texto que copió el marcador…"
          rows={3}
          className="zx-control"
          style={{ width: "100%" }}
        />
        <Boton type="button" variante="secundario" chico style={{ marginTop: 8 }} onClick={importar} disabled={!texto.trim()}>
          Importar al formulario
        </Boton>
      </div>
      {error && <p style={{ marginTop: 10, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{error}</p>}
      {importado && !error && <p style={{ marginTop: 10, color: "var(--kpi-exito-texto)", fontSize: 14 }}>Se importó — revisá el formulario de arriba.</p>}
    </>
  );
}
