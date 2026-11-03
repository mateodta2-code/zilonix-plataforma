"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";

export type CategoriaElegida = { categoryId: string; categoryName: string };
type ResultadoBusqueda = { categoryId: string; categoryName: string; esHoja: boolean; pathFromRoot: { id: string; name: string }[] };
type NodoArbol = {
  categoryId: string;
  categoryName: string;
  esRaiz: boolean;
  esHoja: boolean;
  pathFromRoot: { id: string; name: string }[];
  children: { id: string; name: string }[];
};

// ADENDO UX de Publicar, punto 2 — "buscador de categoría sobre
// buscarCategoriasPorNombre de lib/ml/publicar.ts + override manual.
// Árbol de categorías: UI + ruta que liste raíces/hijos". Dos caminos,
// el mismo que ya usa Zilonix OS actual cuando la detección automática
// (resolverCategoria, que corre sola al pedir "Detectar") se equivoca:
// 1) buscar por NOMBRE real de categoría (con debounce mientras se
// escribe), 2) navegar el árbol real nivel por nivel. Elegir cualquiera
// de los dos dispara `onElegir`, que el formulario usa para refrescar
// las características de ESA categoría (nunca mezclado con la
// detección automática en silencio).
const DEBOUNCE_BUSQUEDA_MS = 350;

export function SelectorCategoria({ cuentaId, onElegir }: { cuentaId: string | null; onElegir: (categoria: CategoriaElegida) => void }) {
  const [modo, setModo] = useState<"cerrado" | "buscar" | "arbol">("cerrado");
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusqueda[] | null>(null);
  const [nodo, setNodo] = useState<NodoArbol | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function buscar(textoBuscado: string) {
    if (!cuentaId || !textoBuscado.trim()) {
      setResultados(null);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const resp = await fetch(`/api/ml/publicar/categorias/buscar?cuentaId=${encodeURIComponent(cuentaId)}&texto=${encodeURIComponent(textoBuscado)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "No se pudo buscar.");
      setResultados(data.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar.");
    } finally {
      setCargando(false);
    }
  }

  // Búsqueda mientras se escribe, con debounce — la primera búsqueda
  // por sitio puede tardar porque recorre el árbol real una sola vez
  // (después queda cacheada, lib/ml/publicar.ts), así que no conviene
  // disparar una llamada por cada tecla.
  useEffect(() => {
    if (modo !== "buscar") return;
    if (timerDebounce.current) clearTimeout(timerDebounce.current);
    if (!texto.trim()) {
      setResultados(null);
      return;
    }
    timerDebounce.current = setTimeout(() => void buscar(texto), DEBOUNCE_BUSQUEDA_MS);
    return () => {
      if (timerDebounce.current) clearTimeout(timerDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, modo, cuentaId]);

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
      {!cuentaId && <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Elige al menos una cuenta primero.</p>}
      {error && <p style={{ fontSize: 13, color: "#b00020", marginTop: 8 }}>{error}</p>}

      {modo === "buscar" && (
        <div style={{ marginTop: 10 }}>
          <Campo etiqueta="Nombre de la categoría (ej. 'Belleza')">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="zx-control"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void buscar(texto);
                  }
                }}
              />
              <Boton type="button" chico onClick={() => void buscar(texto)} disabled={cargando}>
                {cargando ? "Buscando…" : "Buscar"}
              </Boton>
            </div>
          </Campo>
          {resultados && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
              {resultados.length === 0 && <li style={{ fontSize: 13, opacity: 0.7 }}>No se encontraron categorías con ese nombre.</li>}
              {resultados.map((r) => (
                <li key={r.categoryId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                  <span>
                    {r.pathFromRoot.length > 0
                      ? r.pathFromRoot.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && " › "}
                            {p.name}
                          </span>
                        ))
                      : r.categoryName}{" "}
                    <span style={{ opacity: 0.6 }}>({r.categoryId})</span>
                  </span>
                  {r.esHoja ? (
                    <Boton type="button" chico variante="secundario" onClick={() => onElegir({ categoryId: r.categoryId, categoryName: r.categoryName })}>
                      Elegir
                    </Boton>
                  ) : (
                    <Boton
                      type="button"
                      chico
                      variante="secundario"
                      onClick={() => {
                        setModo("arbol");
                        setResultados(null);
                        void navegarArbol(r.categoryId);
                      }}
                    >
                      Entrar ›
                    </Boton>
                  )}
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
