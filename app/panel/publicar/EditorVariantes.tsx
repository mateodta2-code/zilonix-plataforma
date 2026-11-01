"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import type { CaracteristicaCategoria } from "./CaracteristicasDinamicas";
import { productoCartesiano } from "./formulario-logica";

export type CombinacionVariante = { valores: Record<string, string>; sku: string; stock: string; precio: string };
export type VariantesEditadas = { ejes: string[]; ejeFoto: string | null; combinaciones: CombinacionVariante[] };

// ADENDO UX de Publicar, punto 4 — "editor visual de variantes (ejes
// allow_variations, combinaciones, ejeFoto) que genere el JSON que hoy
// se pega a mano; incluir portadasPorVariante por valor del ejeFoto."
// `candidatos` = características que la categoría detectada marca con
// tags.allow_variations (lib/ml/publicar.ts, CaracteristicaCategoria.
// permiteVariante) — solo esos pueden ser eje, nunca inventado. El eje
// con tags.defines_picture (definePic) es el único que puede llevar
// portada propia por valor (seller_custom_field/picture_ids reales de
// Mercado Libre, ver publicarProductoEnCuenta §3.19).
export function EditorVariantes({
  candidatos,
  value,
  portadasPorVariante,
  onChange,
  onCambiarPortadas,
}: {
  candidatos: CaracteristicaCategoria[];
  value: VariantesEditadas | null;
  portadasPorVariante: Record<string, string>;
  onChange: (v: VariantesEditadas | null) => void;
  onCambiarPortadas: (v: Record<string, string>) => void;
}) {
  const [activo, setActivo] = useState(Boolean(value));
  const [ejesElegidos, setEjesElegidos] = useState<string[]>(value?.ejes ?? []);
  const [valoresPorEje, setValoresPorEje] = useState<Record<string, string[]>>({});
  const [ejeFoto, setEjeFoto] = useState<string | null>(value?.ejeFoto ?? null);
  const [combinaciones, setCombinaciones] = useState<CombinacionVariante[]>(value?.combinaciones ?? []);

  if (candidatos.length === 0) return null;

  function alternarEje(ejeId: string) {
    const yaElegido = ejesElegidos.includes(ejeId);
    const nuevos = yaElegido ? ejesElegidos.filter((e) => e !== ejeId) : [...ejesElegidos, ejeId];
    setEjesElegidos(nuevos);
    if (yaElegido && ejeFoto === ejeId) setEjeFoto(null);
  }

  function alternarValor(ejeId: string, valor: string) {
    const actuales = valoresPorEje[ejeId] ?? [];
    const nuevos = actuales.includes(valor) ? actuales.filter((v) => v !== valor) : [...actuales, valor];
    setValoresPorEje({ ...valoresPorEje, [ejeId]: nuevos });
  }

  function generarCombinaciones() {
    const nuevas = productoCartesiano(valoresPorEje, ejesElegidos).map((valores) => ({ valores, sku: "", stock: "", precio: "" }));
    setCombinaciones(nuevas);
    onChange({ ejes: ejesElegidos, ejeFoto, combinaciones: nuevas });
  }

  function actualizarCombinacion(i: number, campo: "sku" | "stock" | "precio", val: string) {
    const nuevas = combinaciones.map((c, idx) => (idx === i ? { ...c, [campo]: val } : c));
    setCombinaciones(nuevas);
    onChange({ ejes: ejesElegidos, ejeFoto, combinaciones: nuevas });
  }

  const ejeFotoDef = candidatos.find((c) => c.id === ejeFoto);
  const valoresDeEjeFoto = ejeFoto ? valoresPorEje[ejeFoto] ?? [] : [];

  return (
    <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
      <label style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => {
            setActivo(e.target.checked);
            if (!e.target.checked) onChange(null);
          }}
        />
        Este producto tiene variantes (talla, color…)
      </label>

      {activo && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 6px" }}>
            Ejes disponibles (la categoría detectada los admite como variante):
          </p>
          {candidatos.map((c) => (
            <div key={c.id} style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={ejesElegidos.includes(c.id)} onChange={() => alternarEje(c.id)} />
                {c.nombre} {c.definePic && <span style={{ fontSize: 11, opacity: 0.6 }}>(puede llevar foto propia)</span>}
              </label>
              {ejesElegidos.includes(c.id) && (
                <div style={{ marginLeft: 24, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {c.valores.length > 0 ? (
                    c.valores.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => alternarValor(c.id, v)}
                        style={{
                          fontSize: 12,
                          padding: "3px 8px",
                          borderRadius: 100,
                          border: "1px solid #ccc",
                          background: (valoresPorEje[c.id] ?? []).includes(v) ? "#000" : "#fff",
                          color: (valoresPorEje[c.id] ?? []).includes(v) ? "#fff" : "#000",
                          cursor: "pointer",
                        }}
                      >
                        {v}
                      </button>
                    ))
                  ) : (
                    <input
                      className="zx-control"
                      placeholder="Valores separados por coma (ej. S,M,L)"
                      onBlur={(e) =>
                        setValoresPorEje({
                          ...valoresPorEje,
                          [c.id]: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                        })
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ))}

          {ejesElegidos.some((e) => candidatos.find((c) => c.id === e)?.definePic) && (
            <Campo etiqueta="¿Cuál de estos ejes tiene foto propia por valor?">
              <select className="zx-control" value={ejeFoto ?? ""} onChange={(e) => setEjeFoto(e.target.value || null)}>
                <option value="">— ninguno —</option>
                {ejesElegidos
                  .filter((e) => candidatos.find((c) => c.id === e)?.definePic)
                  .map((e) => (
                    <option key={e} value={e}>
                      {candidatos.find((c) => c.id === e)?.nombre}
                    </option>
                  ))}
              </select>
            </Campo>
          )}

          <div style={{ marginTop: 10 }}>
            <Boton type="button" variante="secundario" chico onClick={generarCombinaciones} disabled={ejesElegidos.length === 0}>
              Generar combinaciones
            </Boton>
          </div>

          {combinaciones.length > 0 && (
            <table style={{ width: "100%", marginTop: 10, fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {ejesElegidos.map((e) => (
                    <th key={e} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 4 }}>
                      {candidatos.find((c) => c.id === e)?.nombre}
                    </th>
                  ))}
                  <th style={{ borderBottom: "1px solid #ddd", padding: 4 }}>SKU</th>
                  <th style={{ borderBottom: "1px solid #ddd", padding: 4 }}>Stock</th>
                  <th style={{ borderBottom: "1px solid #ddd", padding: 4 }}>Precio (opcional)</th>
                </tr>
              </thead>
              <tbody>
                {combinaciones.map((c, i) => (
                  <tr key={i}>
                    {ejesElegidos.map((e) => (
                      <td key={e} style={{ padding: 4, borderBottom: "1px solid #f3f3f3" }}>
                        {c.valores[e]}
                      </td>
                    ))}
                    <td style={{ padding: 4, borderBottom: "1px solid #f3f3f3" }}>
                      <input className="zx-control" value={c.sku} onChange={(e) => actualizarCombinacion(i, "sku", e.target.value)} style={{ width: 90 }} />
                    </td>
                    <td style={{ padding: 4, borderBottom: "1px solid #f3f3f3" }}>
                      <input className="zx-control" type="number" value={c.stock} onChange={(e) => actualizarCombinacion(i, "stock", e.target.value)} style={{ width: 70 }} />
                    </td>
                    <td style={{ padding: 4, borderBottom: "1px solid #f3f3f3" }}>
                      <input className="zx-control" type="number" value={c.precio} onChange={(e) => actualizarCombinacion(i, "precio", e.target.value)} style={{ width: 90 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {ejeFoto && valoresDeEjeFoto.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 6px" }}>
                Foto propia por cada valor de &quot;{ejeFotoDef?.nombre}&quot; (opcional — si falta, usa la portada general):
              </p>
              {valoresDeEjeFoto.map((v) => (
                <Campo key={v} etiqueta={v}>
                  <input
                    className="zx-control"
                    value={portadasPorVariante[v] ?? ""}
                    onChange={(e) => onCambiarPortadas({ ...portadasPorVariante, [v]: e.target.value })}
                    placeholder="https://…"
                  />
                </Campo>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
