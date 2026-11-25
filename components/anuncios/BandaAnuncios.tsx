"use client";

import { useEffect, useState } from "react";
import { TIPOS_ANUNCIO, type TipoAnuncio } from "@/lib/anuncios-reglas";
import styles from "./BandaAnuncios.module.css";

// Anuncios de la plataforma (25-nov) arriba del panel del vendedor. Cerrar
// uno solo lo oculta en ESTE navegador (localStorage, comodidad por persona):
// si se borra el almacenamiento, vuelve a salir mientras siga vigente.
const CLAVE = "zx-anuncios-cerrados";

function leerCerrados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function BandaAnuncios({ anuncios }: { anuncios: { id: string; mensaje: string; tipo: TipoAnuncio }[] }) {
  const [cerrados, setCerrados] = useState<string[]>([]);
  useEffect(() => setCerrados(leerCerrados()), []);

  const visibles = anuncios.filter((a) => !cerrados.includes(a.id));
  if (visibles.length === 0) return null;

  function cerrar(id: string) {
    // Solo se guardan los ids de anuncios aún vigentes: la lista no crece sin fin.
    const nuevos = [...cerrados.filter((c) => anuncios.some((a) => a.id === c)), id];
    setCerrados(nuevos);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(nuevos));
    } catch {
      // Sin almacenamiento (modo privado): se oculta solo hasta recargar.
    }
  }

  return (
    <div className={styles.lista}>
      {visibles.map((a) => (
        <div key={a.id} className={styles.anuncio} data-tipo={a.tipo} role={a.tipo === "info" ? "status" : "alert"}>
          <p className={styles.texto}>
            <strong>{TIPOS_ANUNCIO[a.tipo] ?? "Aviso"}:</strong> {a.mensaje}
          </p>
          <button type="button" className={styles.cerrar} onClick={() => cerrar(a.id)} aria-label="Cerrar anuncio">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
