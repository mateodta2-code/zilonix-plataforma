"use client";

import { useMemo, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { categoriasFalabellaAction } from "./falabella-actions";
import { MAX_TITULO } from "@/lib/falabella/publicar-reglas";
import styles from "./publicar.module.css";

// Se muestra solo cuando hay una cuenta de Falabella marcada en «Cuentas
// destino». Precio (= el de Asana, es la oferta), stock, SKU y fotos salen de
// «Datos generales»; acá va solo lo propio de Falabella. Al enviar, NO se crea
// nada en Falabella: queda un borrador que se aprueba en el historial.
export function SeccionFalabella({ cuentaId, tituloSugerido }: { cuentaId: string; tituloSugerido: string }) {
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<{ id: number; ruta: string } | null>(null);
  const [lista, setLista] = useState<{ id: number; ruta: string }[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargarCategorias() {
    setCargando(true);
    setError(null);
    const r = await categoriasFalabellaAction(cuentaId);
    setCargando(false);
    if (r.ok) setLista(r.datos);
    else setError(r.error);
  }

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!lista || q.length < 2) return [];
    return lista.filter((c) => c.ruta.toLowerCase().includes(q)).slice(0, 30);
  }, [lista, busqueda]);

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">Falabella</p>
      <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
        Marca GENERICO, IVA 19%, 1 kg y 25×15×25 cm por defecto. El precio de arriba es la oferta (30 días); el precio normal es ese + $25.000. Se
        guarda un borrador que tú apruebas en el historial antes de crearlo.
      </p>

      <Campo etiqueta={`Título en Falabella (máximo ${MAX_TITULO}, sin marcas)`}>
        <input name="falabella_titulo" className="zx-control" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </Campo>
      <p style={{ fontSize: 12, color: titulo.length > MAX_TITULO ? "var(--kpi-peligro-texto)" : "var(--texto-suave)", marginTop: 4 }}>
        {titulo.length}/{MAX_TITULO}
        {tituloSugerido && (
          <>
            {" · "}
            <button type="button" className="zx-enlace" onClick={() => setTitulo(tituloSugerido)}>
              Usar el título de Mercado Libre
            </button>
          </>
        )}
      </p>

      <Campo etiqueta="Descripción">
        <textarea name="falabella_descripcion" className="zx-control" rows={5} />
      </Campo>

      <Campo etiqueta="Marca real (va en el campo Modelo)">
        <input name="falabella_modelo" className="zx-control" />
      </Campo>

      <p className="zx-etiqueta" style={{ marginTop: 16 }}>
        Categoría de Falabella
      </p>
      <input type="hidden" name="falabella_categoria" value={categoria?.id ?? ""} />
      {categoria ? (
        <p style={{ fontSize: 13, marginTop: 8 }}>
          {categoria.ruta}{" "}
          <button type="button" className="zx-enlace" onClick={() => setCategoria(null)}>
            cambiar
          </button>
        </p>
      ) : !lista ? (
        <div style={{ marginTop: 8 }}>
          <Boton type="button" variante="secundario" chico onClick={cargarCategorias} disabled={cargando}>
            {cargando ? "Cargando…" : "Buscar categoría"}
          </Boton>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <input className="zx-control" placeholder="Escribe al menos 2 letras (ej. biberón)" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {coincidencias.map((c) => (
            <button key={c.id} type="button" className={styles.recuadroMarca} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 13, marginTop: 6 }} onClick={() => setCategoria(c)}>
              {c.ruta}
            </button>
          ))}
        </div>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{error}</p>}

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
