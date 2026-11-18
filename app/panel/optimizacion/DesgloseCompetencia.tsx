"use client";

import { useEffect, useState } from "react";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { linkPublicacion } from "@/lib/ml/permalink";
import { formatearMoneda } from "@/lib/ml/sitios";
import { rotuloReputacion, type FilaComparacion } from "@/lib/optimizacion/competencia";
import { rotuloTipoPublicacion } from "@/lib/optimizacion/textos";
import { competenciaPublicacionAction, type ResultadoCompetencia } from "./actions";
import styles from "./page.module.css";

const ENCABEZADOS = [
  "Publicación",
  { clave: "precio", contenido: "Precio", numerica: true },
  "Tipo (cuotas)",
  "Envío gratis",
  "Full",
  { clave: "fotos", contenido: "Fotos", numerica: true },
  "Video",
  "Descripción",
  "Reputación",
];

function siNo(valor: boolean | null): string {
  return valor === null ? "—" : valor ? "Sí" : "No";
}

// Fase 4 — los vendedores del mismo producto de catálogo, contra la
// publicación. Se pide al desplegar la fila (son varias llamadas a ML).
export function DesgloseCompetencia({ cuentaMlId, itemId, siteId }: { cuentaMlId: string; itemId: string; siteId: string }) {
  const [resultado, setResultado] = useState<ResultadoCompetencia | null>(null);

  useEffect(() => {
    let cancelado = false;
    competenciaPublicacionAction({ cuentaMlId, itemId })
      .then((r) => {
        if (!cancelado) setResultado(r);
      })
      .catch(() => {
        if (!cancelado) setResultado({ ok: false, aviso: "No se pudo traer la competencia. Intenta de nuevo." });
      });
    return () => {
      cancelado = true;
    };
  }, [cuentaMlId, itemId]);

  if (resultado === null) return <p className={styles.nota}>Buscando a los vendedores del mismo producto…</p>;
  if (!resultado.ok) return <p className={styles.avisoError}>{resultado.aviso}</p>;
  if (!resultado.catalogo) {
    return (
      <p className={styles.nota}>
        Esta publicación no está en el catálogo de Mercado Libre. La comparación con publicaciones del mismo producto fuera del catálogo (por código de barras o
        marca y modelo) llegará con la extensión.
      </p>
    );
  }
  if (resultado.competidores.length === 0) return <p className={styles.nota}>Nadie más vende este producto en el catálogo. ¡Vas solo!</p>;

  const plata = (v: number | null) => (v === null ? "—" : formatearMoneda(v, siteId));
  const fila = (f: FilaComparacion) => {
    const enlace = linkPublicacion(f.itemId);
    return (
      <FilaTabla key={f.itemId} className={f.propia ? styles.filaPropia : undefined}>
        <CeldaTabla>
          <div className={styles.publicacion}>
            {f.foto ? <img className={styles.foto} src={f.foto} alt="" width={40} height={40} loading="lazy" /> : <span className={styles.foto} />}
            <div>
              {f.propia ? <strong>Tú · </strong> : null}
              {enlace ? (
                <a href={enlace} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                  {f.titulo ?? f.itemId}
                </a>
              ) : (
                (f.titulo ?? f.itemId)
              )}
            </div>
          </div>
        </CeldaTabla>
        <CeldaTabla numerica>
          {plata(f.precio)}
          {f.precioOriginal !== null ? <span className={styles.precioAntes}>{plata(f.precioOriginal)}</span> : null}
        </CeldaTabla>
        <CeldaTabla>{rotuloTipoPublicacion(f.tipoPublicacion)}</CeldaTabla>
        <CeldaTabla>{siNo(f.envioGratis)}</CeldaTabla>
        <CeldaTabla>{siNo(f.full)}</CeldaTabla>
        <CeldaTabla numerica>{f.fotos ?? "—"}</CeldaTabla>
        <CeldaTabla>{siNo(f.video)}</CeldaTabla>
        <CeldaTabla>{siNo(f.descripcion)}</CeldaTabla>
        <CeldaTabla>{f.propia ? "—" : rotuloReputacion(f.reputacion)}</CeldaTabla>
      </FilaTabla>
    );
  };

  return (
    <div className={styles.desglose}>
      {resultado.alertas.length > 0 ? (
        <ul className={styles.alertas}>
          {resultado.alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.avisoOk}>No te falta nada frente a estos vendedores.</p>
      )}
      <Tabla encabezados={ENCABEZADOS}>
        {fila(resultado.propia)}
        {resultado.competidores.map(fila)}
      </Tabla>
      <p className={styles.notaNeutra}>
        {`${resultado.competidores.length} de ${resultado.total} vendedores del mismo producto de catálogo, los más baratos primero. "—" = Mercado Libre no entregó ese dato. Cuotas: en Premium van sin interés. Clips y regalos: por confirmar en Mercado Libre.`}
      </p>
    </div>
  );
}
