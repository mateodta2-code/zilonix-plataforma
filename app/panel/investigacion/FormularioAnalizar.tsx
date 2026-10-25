"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { marcarClicAnalizar, type PlataformaAnalizar } from "./analizarClic";
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

// Issue #229 — "Selector de plataforma de inicio antes de Analizar":
// hasta esta tarea, Analizar arrancaba SIEMPRE con Mercado Libre — las
// otras 5 plataformas solo se podían analizar DESPUÉS, con un segundo
// clic en "Analizar también en…" (PanelInvestigacion.tsx). Ahora la
// persona elige, antes del primer clic, con cuál de las 6 arranca
// este Analizar puntual — el mismo término se puede volver a analizar
// con otra plataforma después (agrega su propio bloque al stack,
// nunca pisa el anterior).
const PLATAFORMAS_ANALIZAR: { clave: PlataformaAnalizar; nombre: string }[] = [
  { clave: "ml", nombre: "Mercado Libre" },
  { clave: "amazon", nombre: "Amazon" },
  { clave: "temu", nombre: "Temu" },
  { clave: "aliexpress", nombre: "AliExpress" },
  { clave: "shein", nombre: "Shein" },
  { clave: "alibaba", nombre: "Alibaba" },
];

// Issue #221 — Client Component a propósito, SOLO para poder marcar
// (sessionStorage, ver analizarClic.ts) que el envío real de este
// formulario vino de un clic real de la persona — justo antes de que
// la navegación normal (GET, sin preventDefault) siga su curso. La
// búsqueda en sí sigue siendo 100% Server Component (page.tsx): este
// componente nunca intercepta ni cambia el submit, solo lo observa
// para dejar la marca (issue #227: con el país elegido; issue #229:
// con la plataforma de inicio elegida).
export function FormularioAnalizar({ termino, tab }: { termino: string; tab: string }) {
  const [pais, setPais] = useState("CO");
  const [plataforma, setPlataforma] = useState<PlataformaAnalizar>("ml");

  return (
    <form method="get" className={styles.filaFormulario} onSubmit={() => marcarClicAnalizar(pais, plataforma)}>
      <Campo etiqueta="Producto o nicho (hasta 3 palabras)">
        <input type="search" name="termino" defaultValue={termino} placeholder='Ej: "reloj digital"' className="zx-control" required />
      </Campo>
      <Campo etiqueta="Plataforma">
        <select className="zx-control" value={plataforma} onChange={(e) => setPlataforma(e.target.value as PlataformaAnalizar)}>
          {PLATAFORMAS_ANALIZAR.map((p) => (
            <option key={p.clave} value={p.clave}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Campo>
      {/* El país solo tiene sentido para Mercado Libre — las otras 5
          plataformas no tienen selector de país propio en esta tarea. */}
      {plataforma === "ml" ? (
        <Campo etiqueta="País (Mercado Libre)">
          <select className="zx-control" value={pais} onChange={(e) => setPais(e.target.value)}>
            {PAISES_ML.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
      ) : null}
      <input type="hidden" name="tab" value={tab} />
      <Boton type="submit">Analizar</Boton>
    </form>
  );
}
