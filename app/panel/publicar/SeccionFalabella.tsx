"use client";

import { useEffect, useMemo, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { atributosFalabellaAction, categoriasFalabellaAction, recomendarCategoriaFalabellaAction } from "./falabella-actions";
import type { AtributoCategoria } from "@/lib/falabella/catalogo";
import { preseleccionarCategorias } from "@/lib/falabella/categorias-sugeridas";
import { construirEan } from "@/lib/falabella/publicar-reglas";
import styles from "./publicar.module.css";

// Campos que ya salen de «Datos generales» o de las reglas fijas: no se piden
// de nuevo aunque la categoría los marque como obligatorios.
const YA_CUBIERTOS = new Set([
  "Name", "Description", "Brand", "SellerSku", "Price", "SpecialPrice", "Stock", "ProductId", "PrimaryCategory", "ConditionType",
  "PackageHeight", "PackageWidth", "PackageLength", "PackageWeight", "TaxPercentage", "Status", "Variation_Name",
]);

// «Características de la categoría» de Falabella (el equivalente al bloque de
// Mercado Libre). Título, descripción y portada van en «Título, descripción y
// portada por cuenta»; precio, stock, SKU y fotos, en «Datos generales».
export function SeccionFalabella({ cuentaId, sku, titulo }: { cuentaId: string; sku: string; titulo: string }) {
  const [categoria, setCategoria] = useState<{ id: number; ruta: string } | null>(null);
  const [lista, setLista] = useState<{ id: number; ruta: string }[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atributos, setAtributos] = useState<AtributoCategoria[] | null>(null);
  const [cargandoAtributos, setCargandoAtributos] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});

  // Como en Mercado Libre: la lista de categorías se trae sola al abrir la
  // sección, sin botón; se filtra al escribir.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    categoriasFalabellaAction(cuentaId).then((r) => {
      if (!vigente) return;
      setCargando(false);
      if (r.ok) {
        setLista(r.datos);
        if (r.datos.length === 0) setError("Falabella no devolvió categorías. Avísale a soporte para revisar la respuesta.");
      } else setError(r.error);
    });
    return () => {
      vigente = false;
    };
  }, [cuentaId]);

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!lista || q.length < 2) return [];
    return lista.filter((c) => c.ruta.toLowerCase().includes(q)).slice(0, 30);
  }, [lista, busqueda]);

  // Sugerencias según el título (palabras del título que aparecen en la ruta
  // de la categoría). Evita elegir a ciegas una categoría que pide campos raros.
  const sugeridas = useMemo(() => (lista ? preseleccionarCategorias(lista, titulo) : []), [lista, titulo]);
  const [recomendadas, setRecomendadas] = useState<{ id: number; ruta: string }[] | null>(null);
  const [conIA, setConIA] = useState(false);
  const [recomendando, setRecomendando] = useState(false);

  async function recomendar() {
    setRecomendando(true);
    setError(null);
    const r = await recomendarCategoriaFalabellaAction(cuentaId, titulo);
    setRecomendando(false);
    if (r.ok) {
      setRecomendadas(r.datos.categorias);
      setConIA(r.datos.conIA);
      if (r.datos.categorias.length === 0) setError("No encontré una categoría parecida al título. Búscala escribiendo una palabra.");
    } else setError(r.error);
  }

  async function elegir(c: { id: number; ruta: string }) {
    setCategoria(c);
    setBusqueda("");
    setAtributos(null);
    setValores({});
    setCargandoAtributos(true);
    setError(null);
    const r = await atributosFalabellaAction(cuentaId, c.id);
    setCargandoAtributos(false);
    if (r.ok) {
      setAtributos(r.datos);
      // País de origen: siempre China (regla de Mateo). Si es lista, se elige la opción que diga China.
      const origen: Record<string, string> = {};
      for (const a of r.datos) {
        if (!/pais.*origen|origen|origin/i.test(`${a.nombre} ${a.etiqueta}`) || /ciudad|city/i.test(a.nombre)) continue;
        const opcion = a.opciones.find((o) => /china/i.test(o));
        if (a.opciones.length === 0) origen[a.nombre] = "China";
        else if (opcion) origen[a.nombre] = opcion;
      }
      setValores(origen);
    } else setError(r.error);
  }

  const modeloAtributo = atributos?.find((a) => a.nombre === "Modelo");
  // Obligatorios de ESTA categoría (los que Falabella pide y no cubrimos ya).
  const obligatorios = (atributos ?? []).filter((a) => a.obligatorio && a.nombre !== "Modelo" && a.nombre !== "Variation" && !YA_CUBIERTOS.has(a.nombre));
  const ean = construirEan(sku);

  function campo(a: { nombre: string; etiqueta: string; opciones: string[]; obligatorio: boolean }) {
    const v = valores[a.nombre] ?? "";
    const poner = (x: string) => setValores((actual) => ({ ...actual, [a.nombre]: x }));
    return (
      <Campo key={a.nombre} etiqueta={`${a.etiqueta || a.nombre}${a.obligatorio ? " *" : ""}`}>
        {a.opciones.length > 0 ? (
          <select className="zx-control" required={a.obligatorio} value={v} onChange={(e) => poner(e.target.value)}>
            <option value="">Elegir…</option>
            {a.opciones.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input className="zx-control" required={a.obligatorio} placeholder={a.nombre === "Variation" ? "Único" : undefined} value={v} onChange={(e) => poner(e.target.value)} />
        )}
      </Campo>
    );
  }

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">Características de la categoría — Falabella</p>
      <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
        Marca GENERICO, IVA 19%, 1 kg y 25×15×25 cm por defecto. El precio de «Datos generales» es la oferta (30 días); el precio normal es ese +
        $25.000. Se guarda un borrador que tú apruebas en el historial antes de crearlo.
      </p>
      <p style={{ fontSize: 13, marginTop: 8 }}>
        Código de barras (EAN, interno de Falabella):{" "}
        {ean ? <strong>{ean}</strong> : <span style={{ color: "var(--kpi-peligro-texto)" }}>el SKU debe terminar en 4 dígitos para armarlo (NIT + últimos 4 del SKU).</span>}
      </p>

      <input type="hidden" name="falabella_categoria" value={categoria?.id ?? ""} />
      <input type="hidden" name="falabella_atributos" value={JSON.stringify(valores)} />

      <p className="zx-etiqueta" style={{ marginTop: 16 }}>
        Categoría de Falabella
      </p>
      {categoria ? (
        <p style={{ fontSize: 13, marginTop: 8 }}>
          <strong>{categoria.ruta}</strong> <span style={{ color: "var(--texto-suave)" }}>({categoria.id})</span>{" "}
          <button type="button" className="zx-enlace" onClick={() => { setCategoria(null); setAtributos(null); setValores({}); }}>
            cambiar
          </button>
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          <input
            className="zx-control"
            placeholder={cargando ? "Cargando categorías de Falabella…" : "Escribe al menos 2 letras (ej. encendedor)"}
            value={busqueda}
            disabled={cargando}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <Boton type="button" variante="secundario" chico onClick={recomendar} disabled={recomendando || cargando || !titulo.trim()}>
              {recomendando ? "Buscando…" : "Recomendar categoría según el título"}
            </Boton>
          </div>
          {recomendadas && recomendadas.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 8 }}>
              {conIA ? "Recomendadas por la IA (de la más a la menos adecuada):" : "Parecidas al título (sin IA conectada para Publicaciones):"}
            </p>
          )}
          {busqueda.trim().length < 2 && !recomendadas && sugeridas.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 8 }}>Sugeridas según el título:</p>
          )}
          {(busqueda.trim().length >= 2 ? coincidencias : recomendadas ?? sugeridas).map((c) => (
            <button key={c.id} type="button" className={styles.recuadroMarca} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 13, marginTop: 6 }} onClick={() => void elegir(c)}>
              {c.ruta}
            </button>
          ))}
        </div>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{error}</p>}

      {categoria && (
        <>
          <p className="zx-etiqueta" style={{ marginTop: 16 }}>
            Atributos obligatorios de la categoría
          </p>
          {cargandoAtributos && <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>Cargando atributos…</p>}
          {atributos && (
            <>
              {/* Modelo (marca real) solo existe en algunas categorías: si la categoría no lo trae, Falabella lo rechaza. Si es lista, solo acepta esas opciones. */}
              {modeloAtributo && campo({ nombre: "Modelo", etiqueta: "Modelo (marca real del producto)", opciones: modeloAtributo.opciones, obligatorio: true })}
              {campo({ nombre: "Variation", etiqueta: "Variación (déjala en «Único» si el producto no tiene variantes)", opciones: [], obligatorio: false })}
              {obligatorios.map((a) => campo(a))}
              {obligatorios.length === 0 && <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 8 }}>Esta categoría no pide más atributos obligatorios.</p>}
            </>
          )}
        </>
      )}

      <p className="zx-etiqueta" style={{ marginTop: 16 }}>
        Medidas reales (solo si el producto no cabe en 25×15×25 cm y 1 kg)
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {[
          ["falabella_largo", "Largo (cm)"],
          ["falabella_ancho", "Ancho (cm)"],
          ["falabella_alto", "Alto (cm)"],
          ["falabella_peso", "Peso (kg)"],
        ].map(([nombre, etiqueta]) => (
          <div key={nombre} style={{ flex: "1 1 100px" }}>
            <Campo etiqueta={etiqueta}>
              <input name={nombre} type="number" step="0.01" min="0" className="zx-control" />
            </Campo>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}
