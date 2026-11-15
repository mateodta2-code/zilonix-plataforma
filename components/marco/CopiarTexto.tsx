"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CopiarTexto.module.css";

const DURACION_AVISO_MS = 1_500;

export type CopiarTextoProps = {
  valor: string;
  // Lo que anuncia el botón (lector de pantalla) — por defecto
  // "Copiar <valor>" (punto 3 de la tarea); una pantalla con más de un
  // SKU visible puede pasar algo más específico si hace falta.
  etiquetaAria?: string;
  // Texto del aviso al copiar — por defecto "Copiado"; Despachos pasa
  // "SKU copiado" (punto 2 de la tarea). Reusable a propósito: otra
  // pantalla que copie un número de pedido, una guía, etc. no debería
  // leer "SKU copiado" sin que de verdad sea un SKU.
  mensajeCopiado?: string;
};

// Issue "copiar SKU en despachos" — componente reutilizable (punto 5):
// cualquier pantalla con un código corto que alguien necesite pegar en
// otro lado (SKU, número de pedido, número de guía...) lo puede usar
// sin duplicar el manejo de navigator.clipboard/el aviso/el fallback.
// Nunca cambia el tamaño/estilo del TEXTO (hereda font/color de donde
// se use) — solo agrega el cursor, el subrayado punteado y el aviso.
export function CopiarTexto({ valor, etiquetaAria, mensajeCopiado = "Copiado" }: CopiarTextoProps) {
  const [estado, setEstado] = useState<"inactivo" | "copiado" | "error">("inactivo");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  async function copiar(evento: React.SyntheticEvent) {
    // Punto 3: el click/Enter/Espacio de este botón NUNCA debe abrir el
    // zoom ni disparar otra acción de la tarjeta que lo contenga.
    evento.stopPropagation();
    try {
      await navigator.clipboard.writeText(valor);
      setEstado("copiado");
    } catch {
      // Sin permiso de portapapeles, navegador viejo, o la página sin
      // foco — el botón ya deja el texto seleccionable (user-select:
      // text, CopiarTexto.module.css) para copiar a mano como respaldo.
      setEstado("error");
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setEstado("inactivo"), DURACION_AVISO_MS);
  }

  return (
    <span className={styles.contenedor}>
      <button type="button" className={styles.boton} onClick={copiar} aria-label={etiquetaAria ?? `Copiar ${valor}`}>
        {valor}
      </button>
      {estado === "copiado" && (
        <span className={styles.aviso} role="status">
          ✓ {mensajeCopiado}
        </span>
      )}
      {estado === "error" && (
        <span className={styles.avisoError} role="status">
          No se pudo copiar
        </span>
      )}
    </span>
  );
}
