"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "@/components/marco/Chip";
import { fotoDeTermino, suscribirFotoBusqueda } from "@/lib/ml/fotoMemoria";
import { linkHttpSeguro, type Bloque, type ProductoListado } from "@/lib/ml/listadoCliente";
import { formatearMoneda } from "@/lib/ml/sitios";
import { seleccionarCandidatos, siteIdDePais, type Veredicto } from "@/lib/ml/buscarPorFoto";
import styles from "./page.module.css";

// «Buscar por foto», paso 2 — cuando llega el listado de Mercado Libre,
// compara la foto con las miniaturas de hasta 12 candidatos en UNA sola
// llamada (la IA que conectó la empresa). Se muestra como una sección
// aparte ENCIMA del listado: el listado completo nunca se toca ni se
// esconde, así que si la comparación falla solo aparece un aviso.
// La foto sale de la memoria del navegador (lib/ml/fotoMemoria.ts): si la
// persona recarga la página, esta sección simplemente no aparece.
type Resultado = { veredicto: Veredicto; motivo: string };

function formatearPrecio(precio: number, pais: string): string {
  const siteId = siteIdDePais(pais);
  // UY/PE no están en SITIOS_ML: sin símbolo inventado, solo el número.
  return siteId ? formatearMoneda(precio, siteId) : new Intl.NumberFormat("es").format(precio);
}

function base64ABlob(base64: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

export function ComparacionFoto({ termino, bloques }: { termino: string; bloques: Bloque[] }) {
  const [version, setVersion] = useState(0);
  useEffect(() => suscribirFotoBusqueda(() => setVersion((v) => v + 1)), []);
  // `version` fuerza releer la variable de memoria cuando cambia.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const foto = useMemo(() => fotoDeTermino(termino), [termino, version]);

  const candidatos = useMemo(() => {
    const productos = bloques.filter((b) => b.plataforma.startsWith("Mercado Libre")).flatMap((b) => b.productos);
    return seleccionarCandidatos(productos);
  }, [bloques]);
  const clave = candidatos.map((c) => c.url).join("|");

  const [estado, setEstado] = useState<"idle" | "comparando" | "listo" | "error">("idle");
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [verDescartados, setVerDescartados] = useState(false);
  const comparadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!foto || !candidatos.length) return;
    // Una sola comparación por búsqueda + juego de candidatos: nunca se
    // repite sola (cada llamada la paga la IA de la empresa).
    const llave = `${foto.termino}|${clave}`;
    if (comparadoRef.current === llave) return;
    comparadoRef.current = llave;
    const control = new AbortController();
    setEstado("comparando");
    setMensajeError(null);
    const form = new FormData();
    form.append("imagen", base64ABlob(foto.base64), "foto.jpg");
    form.append("candidatos", JSON.stringify(candidatos.map((c) => ({ id: c.id, url: c.url }))));
    fetch("/api/investigacion/buscar-por-foto/comparar", { method: "POST", body: form, signal: control.signal })
      .then(async (res) => {
        const datos = (await res.json().catch(() => null)) as { error?: string; resultados?: { id: string; veredicto: Veredicto; motivo: string }[] } | null;
        if (!res.ok || !datos?.resultados) {
          setMensajeError(datos?.error ?? "No se pudo comparar con tu foto.");
          setEstado("error");
          return;
        }
        setResultados(Object.fromEntries(datos.resultados.map((r) => [r.id, { veredicto: r.veredicto, motivo: r.motivo }])));
        setEstado("listo");
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        setMensajeError("No se pudo comparar con tu foto.");
        setEstado("error");
      });
    return () => {
      control.abort();
      // Si se canceló antes de terminar, se permite reintentar con esta misma llave.
      if (comparadoRef.current === llave) comparadoRef.current = null;
    };
  }, [foto, clave, candidatos]);

  if (!foto || !candidatos.length) return null;

  const grupo = (v: Veredicto) => candidatos.filter((c) => (resultados[c.id]?.veredicto ?? "dudoso") === v);
  const iguales = grupo("igual");
  const parecidos = grupo("parecido");
  const dudosos = grupo("dudoso");
  const distintos = grupo("distinto");

  function tarjeta(c: (typeof candidatos)[number], etiqueta?: { texto: string; estado: "exito" | "aviso" | "neutro" | "peligro" }) {
    const p: ProductoListado = c.producto;
    const enlace = linkHttpSeguro(p.link);
    return (
      <div key={c.id} className={styles.comparacionTarjeta}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.url} alt={p.titulo} loading="lazy" referrerPolicy="no-referrer" />
        <div className={styles.comparacionTexto}>
          {etiqueta ? <Chip estado={etiqueta.estado}>{etiqueta.texto}</Chip> : null}
          {enlace ? (
            <a href={enlace} target="_blank" rel="noopener noreferrer">
              {p.titulo}
            </a>
          ) : (
            <span>{p.titulo}</span>
          )}
          <strong>{formatearPrecio(p.precio, foto!.pais)}</strong>
          {resultados[c.id]?.motivo ? <span>{resultados[c.id].motivo}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <section className={styles.comparacion} aria-label="Comparación con tu foto">
      <h3 className={styles.tituloSeccion}>Comparación con tu foto</h3>
      {estado === "comparando" ? <p className={styles.fotoEstado}>Comparando tu foto con {candidatos.length} publicaciones…</p> : null}
      {estado === "error" ? (
        <p className={styles.fotoAviso} role="alert">
          {mensajeError} Se muestra el listado completo, sin filtrar.
        </p>
      ) : null}
      {estado === "listo" ? (
        <>
          {iguales.length ? (
            <div className={styles.comparacionGrupo}>
              <div className={styles.comparacionLista}>{iguales.map((c) => tarjeta(c, { texto: "Se ve igual", estado: "exito" }))}</div>
            </div>
          ) : null}
          {parecidos.length ? (
            <div className={styles.comparacionGrupo}>
              <div className={styles.comparacionLista}>{parecidos.map((c) => tarjeta(c, { texto: "Parecido", estado: "aviso" }))}</div>
            </div>
          ) : null}
          {!iguales.length && !parecidos.length ? <p className={styles.fotoEstado}>Ninguna de las primeras publicaciones se parece a tu foto.</p> : null}
          {dudosos.length ? (
            <div className={styles.comparacionGrupo}>
              <h4 className={styles.tituloSeccion}>Dudosos</h4>
              <div className={styles.comparacionLista}>{dudosos.map((c) => tarjeta(c, { texto: "Dudoso", estado: "neutro" }))}</div>
            </div>
          ) : null}
          {distintos.length ? (
            <>
              <label className={styles.fotoEstado}>
                <input type="checkbox" checked={verDescartados} onChange={(e) => setVerDescartados(e.target.checked)} /> Mostrar descartados ({distintos.length})
              </label>
              {verDescartados ? <div className={styles.comparacionLista}>{distintos.map((c) => tarjeta(c, { texto: "Distinto", estado: "peligro" }))}</div> : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
