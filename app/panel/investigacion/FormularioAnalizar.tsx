"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { marcarClicAnalizar } from "./analizarClic";
import styles from "./page.module.css";

// Issue #227 — selector de país ML: Colombia es el default real de
// esta plataforma (la empresa conecta su cuenta de ML en CO); el
// resto son los países donde Mercado Libre opera, para analizar un
// nicho fuera de Colombia. Brasil usa "Mercado Livre" (su marca real
// en portugués) — mismo dominio, nombre distinto, nunca mezclado.
const PAISES_ML = [
  { codigo: "CO", nombre: "Colombia" },
  { codigo: "AR", nombre: "Argentina" },
  { codigo: "BR", nombre: "Brasil (Mercado Livre)" },
  { codigo: "MX", nombre: "México" },
  { codigo: "CL", nombre: "Chile" },
  { codigo: "UY", nombre: "Uruguay" },
  { codigo: "PE", nombre: "Perú" },
];

// Issue #221 — Client Component a propósito, SOLO para poder marcar
// (sessionStorage, ver analizarClic.ts) que el envío real de este
// formulario vino de un clic real de la persona — justo antes de que
// la navegación normal (GET, sin preventDefault) siga su curso. La
// búsqueda en sí sigue siendo 100% Server Component (page.tsx): este
// componente nunca intercepta ni cambia el submit, solo lo observa
// para dejar la marca (issue #227: ahora con el país elegido).
export function FormularioAnalizar({ termino, tab }: { termino: string; tab: string }) {
  const [pais, setPais] = useState("CO");

  return (
    <form method="get" className={styles.filaFormulario} onSubmit={() => marcarClicAnalizar(pais)}>
      <Campo etiqueta="Producto o nicho (hasta 3 palabras)">
        <input type="search" name="termino" defaultValue={termino} placeholder='Ej: "reloj digital"' className="zx-control" required />
      </Campo>
      <Campo etiqueta="País (Mercado Libre)">
        <select className="zx-control" value={pais} onChange={(e) => setPais(e.target.value)}>
          {PAISES_ML.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <input type="hidden" name="tab" value={tab} />
      <Boton type="submit">Analizar</Boton>
    </form>
  );
}
