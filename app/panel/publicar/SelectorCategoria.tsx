"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";

export type CategoriaElegida = { categoryId: string; categoryName: string };
type ResultadoBusqueda = { categoryId: string; categoryName: string; domainName: string | null };
type NodoArbol = {
  categoryId: string;
  categoryName: string;
  esRaiz: boolean;
  esHoja: boolean;
  pathFromRoot: { id: string; name: string }[];
  children: { id: string; name: string }[];
};

// ADENDO UX de Publicar, punto 2 — "buscador de categoría sobre
// buscarCategorias de lib/ml/publicar.ts + override manual. Árbol de
// categorías: UI + ruta que liste raíces/hijos". Dos caminos, el mismo
// que ya usa Zilonix OS actual cuando la detección automática
// (resolverCategoria, que corre sola al pedir "Detectar") se equivoca:
// 1) buscar por texto propio, 2) navegar el árbol real nivel por
// nivel. Elegir cualquiera de los dos dispara `onElegir`, que el
// formulario usa para refrescar las características de ESA categoría
// (nunca mezclado con la detección automática en silencio).
export function SelectorCategoria({ cuentaId, onElegir }: { cuentaId: string | null; onElegir: (categoria: CategoriaElegida) => void }) {
  const [modo, setModo] = useState<"cerrado" | "buscar" | "arbol">("cerrado");
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusqueda[] | null>(null);
  const [nodo, setNodo] = useState<NodoArbol | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar() {
    if (!cuentaId || !texto.trim()) return;
    setCargando(true);
    setError(null);
    try {
      const resp = await fetch(`/api/ml/publicar/categorias/buscar?cuentaId=${encodeURIComponent(cuentaId)}&texto=${encodeURIComponent(texto)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "No se pudo buscar.");
      setResultados(data.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar.");
    } finally {
      setCargando(false);
    }
  }

  async function navegarArbol(categoryId?: string) {
    if (!cuentaId) return;
    setCargando(true);
    setError(null);
    try {
      const url = categoryId
        ? `/api/ml/publicar/categorias/arbol?cuentaId=${encodeURIComponent(cuentaId)}&categoryId=${encodeURIComponent(categoryId)}`
        : `/api/ml/publicar/categorias/arbol?cuentaId=${encodeURIComponent(cuentaId)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "No se pudo leer el árbol.");
      setNodo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el árbol.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Boton
          type="button"
          variante="secundario"
          chico
          disabled={!cuentaId}
          onClick={() => {
            setModo(modo === "buscar" ? "cerrado" : "buscar");
            setNodo(null);
          }}
        >
          Buscar categoría a mano
        </Boton>
        <Boton
          type="button"
          variante="secundario"
          chico
          disabled={!cuentaId}
          onClick={() => {
            const abrir = modo !== "arbol";
            setModo(abrir ? "arbol" : "cerrado");
            setResultados(null);
            if (abrir && !nodo) void navegarArbol();
          }}
        >
          Navegar el árbol de categorías
        </Boton>
      </div>
      {!cuentaId && <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Elegí al menos una cuenta primero.</p>}
      {error && <p style={{ fontSize: 13, color: "#b00020", marginTop: 8 }}>{error}</p>}

      {modo === "buscar" && (
        <div style={{ marginTop: 10 }}>
          <Campo etiqueta="Texto a buscar (ej. 'reloj digital hombre')">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="zx-control"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void buscar();
                  }
                }}
              />
              <Boton type="button" chico onClick={buscar} disabled={cargando}>
                {cargando ? "Buscando…" : "Buscar"}
              </Boton>
            </div>
          </Campo>
          {resultados && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
              {resultados.length === 0 && <li style={{ fontSize: 13, opacity: 0.7 }}>Sin resultados para ese texto.</li>}
              {resultados.map((r) => (
                <li key={r.categoryId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                  <span>
                    {r.categoryName} <span style={{ opacity: 0.6 }}>({r.categoryId})</span>
                  </span>
                  <Boton type="button" chico variante="secundario" onClick={() => onElegir({ categoryId: r.categoryId, categoryName: r.categoryName })}>
                    Elegir
                  </Boton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modo === "arbol" && nodo && (
        <div style={{ marginTop: 10 }}>
          {nodo.pathFromRoot.length > 0 && (
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              {nodo.pathFromRoot.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && " › "}
                  <button type="button" onClick={() => navegarArbol(i === nodo.pathFromRoot.length - 1 ? undefined : nodo.pathFromRoot[i].id)} style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                    {p.name}
                  </button>
                </span>
              ))}
            </p>
          )}
          {nodo.esHoja ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
              <strong style={{ fontSize: 13 }}>{nodo.categoryName}</strong>
              <Boton type="button" chico onClick={() => onElegir({ categoryId: nodo.categoryId, categoryName: nodo.categoryName })}>
                Elegir esta categoría
              </Boton>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {nodo.children.map((c) => (
                <li key={c.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                  <button type="button" onClick={() => navegarArbol(c.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" }}>
                    {c.name} ›
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cargando && <p style={{ fontSize: 12, opacity: 0.7 }}>Cargando…</p>}
        </div>
      )}
    </div>
  );
}
