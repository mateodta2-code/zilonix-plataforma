"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { variacion } from "@/lib/optimizacion/calculos";
import { bitacoraGeneralResultadoAction, type FilaResultadoGeneral, type ResultadoBitacoraGeneral } from "../actions";
import styles from "./bitacora.module.css";

// Una fila ya lista para mostrar (el servidor da formato a fecha y montos).
export type FilaBitacoraVista = {
  ref: string;
  itemId: string;
  cuentaMlId: string | null;
  cuenta: string;
  fecha: string;
  rotulo: string;
  queCambio: string;
  usuario: string;
  estado: "midiendo" | "listo" | "revisado" | "sin_revisar";
  faltanDias: number;
  // Nota de accionable: se mide a 14 días (el servidor ya calculó estado y faltanDias).
  accionable?: boolean;
  hrefDetalle: string;
};

const ROTULO_ESTADO: Record<FilaBitacoraVista["estado"], { texto: string; chip: EstadoChip }> = {
  midiendo: { texto: "Midiendo", chip: "aviso" },
  listo: { texto: "Listo para revisar", chip: "advertencia" },
  revisado: { texto: "Revisado", chip: "exito" },
  sin_revisar: { texto: "Sin revisar", chip: "neutro" },
};

function ResultadoCelda({ fila }: { fila: FilaBitacoraVista }) {
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoBitacoraGeneral | null>(null);
  if (fila.estado === "midiendo") return <span>{`Midiendo, faltan ${fila.faltanDias} ${fila.faltanDias === 1 ? "día" : "días"}`}</span>;

  async function ver() {
    if (!fila.cuentaMlId) return;
    setCargando(true);
    try {
      setResultado(await bitacoraGeneralResultadoAction({ cuentaMlId: fila.cuentaMlId, itemId: fila.itemId, ref: fila.ref }));
    } catch {
      setResultado({ ok: false, aviso: "No se pudo calcular el resultado. Intenta de nuevo." });
    }
    setCargando(false);
  }

  if (cargando) return <BarraCarga estado="cargando" titulo="Calculando el resultado…" sticky={false} />;
  if (!resultado) {
    return fila.cuentaMlId ? (
      <Boton type="button" variante="secundario" chico onClick={ver}>
        Ver resultado
      </Boton>
    ) : (
      <span title="Este cambio es anterior a la bitácora general y no guardó la cuenta.">—</span>
    );
  }
  if (!resultado.ok) return <span>{resultado.aviso}</span>;
  if (resultado.estado === "midiendo") return <span>{`Midiendo, faltan ${resultado.faltanDias} días`}</span>;
  const linea = (nombre: string, a: FilaResultadoGeneral[keyof FilaResultadoGeneral], d: FilaResultadoGeneral[keyof FilaResultadoGeneral], numerico: boolean) => {
    const v = numerico ? variacion(typeof d === "number" ? d : null, typeof a === "number" ? a : null) : null;
    const pct = v === null ? "" : ` (${Number(v) > 0 ? "+" : ""}${Number(v).toLocaleString("es", { maximumFractionDigits: 0 })} %)`;
    return `${nombre} ${a ?? "—"} → ${d ?? "—"}${pct}`;
  };
  return (
    <div className={styles.resultado}>
      <strong>{resultado.dias === 14 ? "Resultado a 14 días (14 días antes vs. 14 días después)" : "Resultado al día 8 (7 días antes vs. 7 días después)"}</strong>
      <span>{linea("Visitas", resultado.antes.visitas, resultado.despues.visitas, true)}</span>
      <span>{linea("Ventas", resultado.antes.ventas, resultado.despues.ventas, true)}</span>
      <span>{linea("Conversión", resultado.antes.conversion === null ? null : `${resultado.antes.conversion} %`, resultado.despues.conversion === null ? null : `${resultado.despues.conversion} %`, false)}</span>
      {resultado.conFinanzas ? <span>{linea("Utilidad", resultado.antes.utilidad, resultado.despues.utilidad, false)}</span> : null}
    </div>
  );
}

export function TablaBitacoraGeneral({ filas }: { filas: FilaBitacoraVista[] }) {
  return (
    <Tabla encabezados={["Fecha", "Publicación", "Cuenta", "Qué cambió", "Quién", "Estado", "Resultado"]}>
      {filas.map((f) => (
        <FilaTabla key={f.ref}>
          <CeldaTabla>{f.fecha}</CeldaTabla>
          <CeldaTabla>
            <a className={styles.enlace} href={f.hrefDetalle}>
              {f.itemId}
            </a>
          </CeldaTabla>
          <CeldaTabla>{f.cuenta}</CeldaTabla>
          <CeldaTabla>
            <strong>{f.rotulo}</strong>
            {f.accionable ? <Chip estado="neutro">Accionable</Chip> : null}
            <div>{f.queCambio}</div>
          </CeldaTabla>
          <CeldaTabla>{f.usuario}</CeldaTabla>
          <CeldaTabla>
            <Chip estado={ROTULO_ESTADO[f.estado].chip}>{ROTULO_ESTADO[f.estado].texto}</Chip>
          </CeldaTabla>
          <CeldaTabla>
            <ResultadoCelda fila={f} />
          </CeldaTabla>
        </FilaTabla>
      ))}
    </Tabla>
  );
}
