"use client";

import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { marcarClicAnalizar } from "./analizarClic";
import styles from "./page.module.css";

// Issue #221 — "Clic Analizar = el único clic que autoriza abrir
// pestañas": Client Component a propósito, SOLO para poder marcar
// (sessionStorage, ver analizarClic.ts) que el envío real de este
// formulario vino de un clic real de la persona — justo antes de que
// la navegación normal (GET, sin preventDefault) siga su curso. La
// búsqueda en sí sigue siendo 100% Server Component (page.tsx):
// este componente nunca intercepta ni cambia el submit, solo lo
// observa para dejar la marca.
export function FormularioAnalizar({ termino, tab }: { termino: string; tab: string }) {
  return (
    <form method="get" className={styles.filaFormulario} onSubmit={marcarClicAnalizar}>
      <Campo etiqueta="Producto o nicho (hasta 3 palabras)">
        <input type="search" name="termino" defaultValue={termino} placeholder='Ej: "reloj digital"' className="zx-control" required />
      </Campo>
      <input type="hidden" name="tab" value={tab} />
      <Boton type="submit">Analizar</Boton>
    </form>
  );
}
