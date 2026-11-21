"use client";

import { useState } from "react";
import { Campo } from "@/components/marco/Campo";

export type CaracteristicaCategoria = {
  id: string;
  nombre: string;
  obligatorio: boolean;
  valores: string[];
  valueType: string | null;
  permiteVariante: boolean;
  definePic: boolean;
  unidades?: string[]; // solo value_type "number_unit"
  unidadPorDefecto?: string | null;
};

const OTRO = "__otro__";

// Separa un valor guardado tipo «18 años» en número + unidad (así
// funcionan Reintentar y Duplicar). Si la unidad guardada no está entre
// las permitidas, se conserva igual para no perder lo que escribió la persona.
export function separarNumeroUnidad(valor: string): { numero: string; unidad: string } {
  const m = String(valor ?? "").trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  return m ? { numero: m[1], unidad: m[2].trim() } : { numero: String(valor ?? ""), unidad: "" };
}

export function combinarNumeroUnidad(numero: string, unidad: string): string {
  const n = numero.trim();
  return n === "" ? "" : unidad ? `${n} ${unidad}` : n;
}

function FilaNumeroUnidad({ attr, valor, onCambiar }: { attr: CaracteristicaCategoria; valor: string; onCambiar: (valor: string) => void }) {
  const unidades = attr.unidades ?? [];
  const guardado = separarNumeroUnidad(valor);
  // La unidad elegida se recuerda aparte: si se elige antes de escribir el número, no se pierde.
  const [unidadElegida, setUnidadElegida] = useState("");
  const unidad = guardado.unidad || unidadElegida || attr.unidadPorDefecto || unidades[0] || "";
  const opciones = unidad && !unidades.includes(unidad) ? [...unidades, unidad] : unidades;
  return (
    <Campo
      etiqueta={
        <>
          {attr.nombre}
          {attr.obligatorio && <span style={{ color: "var(--peligro-texto)" }}> *</span>}
        </>
      }
    >
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="zx-control"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={guardado.numero.replace(",", ".")}
          onChange={(e) => onCambiar(combinarNumeroUnidad(e.target.value, unidad))}
          placeholder="Escribe el valor"
          aria-label={`${attr.nombre} (número)`}
        />
        <select className="zx-control" value={unidad} onChange={(e) => {
            setUnidadElegida(e.target.value);
            onCambiar(combinarNumeroUnidad(guardado.numero, e.target.value));
          }}
          aria-label={`${attr.nombre} (unidad)`}>
          {opciones.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </Campo>
  );
}

// Un atributo: <select> con los valores reales de la categoría (≤60,
// tal como los expone Mercado Libre) + "✏️ Otro (escribir)…" al final
// — mismo criterio que Zilonix OS actual. Elegir "Otro" revela un
// input de texto libre; lib/ml/publicar-reglas.ts
// (canonicalizarValorListaCerrada) valida server-side si la categoría
// exige un valor cerrado, así que escribir algo que no exista en la
// lista real avisa con las opciones válidas en vez de publicar mal.
function FilaAtributo({ attr, valor, onCambiar }: { attr: CaracteristicaCategoria; valor: string; onCambiar: (valor: string) => void }) {
  if (attr.valueType === "number_unit" && (attr.unidades?.length ?? 0) > 0) return <FilaNumeroUnidad attr={attr} valor={valor} onCambiar={onCambiar} />;
  return <FilaTextoOLista attr={attr} valor={valor} onCambiar={onCambiar} />;
}

function FilaTextoOLista({ attr, valor, onCambiar }: { attr: CaracteristicaCategoria; valor: string; onCambiar: (valor: string) => void }) {
  const [modoLibre, setModoLibre] = useState(() => valor !== "" && !attr.valores.includes(valor));
  return (
    <Campo
      etiqueta={
        <>
          {attr.nombre}
          {attr.obligatorio && <span style={{ color: "var(--peligro-texto)" }}> *</span>}
          {attr.permiteVariante && <span style={{ fontSize: 11, opacity: 0.6 }}> (puede ser eje de variante)</span>}
        </>
      }
    >
      {attr.valores.length > 0 && !modoLibre ? (
        <select
          className="zx-control"
          value={valor}
          onChange={(e) => {
            if (e.target.value === OTRO) {
              setModoLibre(true);
              onCambiar("");
            } else {
              onCambiar(e.target.value);
            }
          }}
        >
          <option value="">— sin elegir —</option>
          {attr.valores.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          <option value={OTRO}>✏️ Otro (escribir)…</option>
        </select>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input className="zx-control" value={valor} onChange={(e) => onCambiar(e.target.value)} placeholder="Escribe el valor" />
          {attr.valores.length > 0 && (
            <button type="button" onClick={() => setModoLibre(false)} style={{ fontSize: 12, background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}>
              Elegir de la lista
            </button>
          )}
        </div>
      )}
    </Campo>
  );
}

// ADENDO UX de Publicar, punto 3 — "atributos dinámicos con
// obtenerCaracteristicasCategoria (principales/secundarias, listas
// ≤60 + 'Otro')". Lo que la persona llena acá se junta en
// `atributosExtra` (mismo formato ID=valor que ya consume
// nuevo/actions.ts/lib/ml/publicar.ts — resolverAtributosObligatorios
// decide qué hacer con lo obligatorio que nadie llenó, GTIN/BRAND/
// GENDER, etc. — esta UI solo recolecta, nunca reimplementa esas
// reglas en el cliente).
export function CaracteristicasDinamicas({
  principales,
  secundarias,
  valores,
  onCambiar,
}: {
  principales: CaracteristicaCategoria[];
  secundarias: CaracteristicaCategoria[];
  valores: Record<string, string>;
  onCambiar: (id: string, valor: string) => void;
}) {
  const [verSecundarias, setVerSecundarias] = useState(false);
  if (principales.length === 0 && secundarias.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {principales.map((attr) => (
        <FilaAtributo key={attr.id} attr={attr} valor={valores[attr.id] ?? ""} onCambiar={(v) => onCambiar(attr.id, v)} />
      ))}
      {secundarias.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setVerSecundarias(!verSecundarias)}
            style={{ fontSize: 12, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 4 }}
          >
            {verSecundarias ? "Ocultar" : "Mostrar"} {secundarias.length} característica(s) secundaria(s)
          </button>
          {verSecundarias &&
            secundarias.map((attr) => <FilaAtributo key={attr.id} attr={attr} valor={valores[attr.id] ?? ""} onCambiar={(v) => onCambiar(attr.id, v)} />)}
        </>
      )}
    </div>
  );
}
