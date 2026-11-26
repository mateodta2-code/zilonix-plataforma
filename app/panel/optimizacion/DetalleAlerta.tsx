"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import type { ClaveAlerta } from "@/lib/optimizacion/alertas";
import { rotuloCompetencia } from "@/lib/optimizacion/textos";
import { moderacionPublicacionAction, type ResultadoModeracionPublicacion } from "./actions";
import styles from "./page.module.css";

// Detalle por publicación de la lista filtrada por una alerta. Solo
// lectura: enlaza a la publicación en Seller y, en moderadas, abre el
// motivo y qué hacer tal cual los escribe Mercado Libre (una llamada, solo
// al abrir).

export type ReferenciaPrecioFila = { precioSugerido: number | null; diferenciaPorcentaje: number | null };

type Props = {
  clave: ClaveAlerta;
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  filas: { id: string; titulo: string | null }[];
  referencias?: Record<string, ReferenciaPrecioFila>;
  estados?: Record<string, string>;
};

function Moderacion({ cuentaMlId, itemId }: { cuentaMlId: string; itemId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [resultado, setResultado] = useState<ResultadoModeracionPublicacion | null>(null);
  const [pendiente, empezar] = useTransition();

  function alternar() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && !resultado) {
      empezar(async () => {
        try {
          setResultado(await moderacionPublicacionAction({ cuentaMlId, itemId }));
        } catch {
          setResultado({ ok: false, aviso: "No se pudo consultar Mercado Libre. Intenta de nuevo." });
        }
      });
    }
  }

  return (
    <div>
      <Boton type="button" variante="secundario" chico onClick={alternar} aria-expanded={abierto}>
        Conoce qué pasó
      </Boton>
      {abierto ? (
        <div className={styles.nota} role="region" aria-label={`Moderación de ${itemId}`}>
          {pendiente || !resultado ? (
            <span>Consultando Mercado Libre…</span>
          ) : !resultado.ok ? (
            <span className={styles.avisoError}>{resultado.aviso}</span>
          ) : !resultado.moderacion || (!resultado.moderacion.motivo && !resultado.moderacion.solucion) ? (
            <span>Mercado Libre no entregó el detalle de esta moderación.</span>
          ) : (
            <>
              {resultado.moderacion.motivo ? <p><strong>Motivo:</strong> {resultado.moderacion.motivo}</p> : null}
              {resultado.moderacion.solucion ? <p><strong>Qué hacer:</strong> {resultado.moderacion.solucion}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function DetalleAlerta({ clave, cuentaMlId, siteId, idioma, filas, referencias, estados }: Props) {
  if (filas.length === 0) return null;
  return (
    <ul className={styles.listaTitulos} aria-label="Detalle de la alerta">
      {filas.map((f) => {
        const ref = referencias?.[f.id];
        const estado = estados?.[f.id] ?? null;
        return (
          <li key={f.id} className={styles.alertaFilaDetalle}>
            <Link href={`/panel/optimizacion/${f.id}?cuenta=${cuentaMlId}`}>{f.titulo ?? f.id}</Link>
            {clave === "precio_alto" && ref && ref.precioSugerido !== null ? (
              <Chip estado="advertencia">
                {`Precio de referencia: ${formatearMoneda(ref.precioSugerido, siteId)}${ref.diferenciaPorcentaje !== null ? ` (−${formatearNumero(Math.round(Math.abs(ref.diferenciaPorcentaje)), idioma)} %)` : ""}`}
              </Chip>
            ) : null}
            {clave === "competencia" && estado ? <Chip estado={rotuloCompetencia(estado).tono === "exito" ? "exito" : "advertencia"}>{rotuloCompetencia(estado).rotulo}</Chip> : null}
            {clave === "moderadas" ? <Moderacion cuentaMlId={cuentaMlId} itemId={f.id} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
