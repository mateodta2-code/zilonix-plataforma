"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import styles from "./page.module.css";

export type FilaImpresionMasiva = {
  id: string;
  shipmentIdExterno: string;
  logisticType: string | null;
  status: string | null;
  actualizadoTs: Date;
};

export type ImpresionMasivaFormProps = {
  filas: FilaImpresionMasiva[];
  total: number;
  tamanoPagina: number;
  etiquetaTipo: Record<string, string>;
};

function colorEstadoDespacho(estado: string | null): EstadoChip {
  if (estado === "ready_to_ship") return "exito";
  if (estado === "handling" || estado === "pending") return "aviso";
  return "neutro";
}

function formatoFechaColombia(fecha: Date): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

// Issue "ocultar imprimir en recogidas" — bug real reportado por
// Mateo en staging: este form era <form action="/api/ml/despachos/etiquetas"
// method="POST" target="_blank">, un POST normal de navegador. Cuando
// Mercado Libre rechaza el lote (ej. una de las ventas elegidas ya la
// recogió la transportadora — EtiquetaNoImprimibleError, lib/ml/despachos.ts),
// el Route Handler responde JSON (nunca un PDF), y esa pestaña nueva
// mostraba el JSON crudo tal cual. Ahora se pide con fetch: si falla,
// el error se muestra ACÁ (mismo párrafo que usa TarjetaDespachoCliente),
// nunca en una pestaña; solo si de verdad llegó un PDF se abre una
// pestaña (con un blob: URL propio).
export function ImpresionMasivaForm({ filas, total, tamanoPagina, etiquetaTipo }: ImpresionMasivaFormProps) {
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnCurso(true);
    setError(null);
    try {
      const datosForm = new FormData(evento.currentTarget);
      const resp = await fetch("/api/ml/despachos/etiquetas", { method: "POST", body: datosForm });
      if (!resp.ok) {
        const datos: unknown = await resp.json().catch(() => null);
        const mensaje = datos && typeof datos === "object" && "error" in datos && typeof datos.error === "string" ? datos.error : "No se pudieron imprimir las etiquetas.";
        setError(mensaje);
        return;
      }
      const pdf = await resp.blob();
      window.open(URL.createObjectURL(pdf), "_blank");
    } catch {
      setError("No se pudieron imprimir las etiquetas.");
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <form onSubmit={enviar} className={styles.form}>
      <Tabla encabezados={["", "Envío", "Tipo", "Estado", "Actualizado"]}>
        {filas.map((d) => (
          <FilaTabla key={d.id}>
            <CeldaTabla>
              <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked aria-label={`Seleccionar envío ${d.shipmentIdExterno}`} />
            </CeldaTabla>
            <CeldaTabla>#{d.shipmentIdExterno}</CeldaTabla>
            <CeldaTabla>{etiquetaTipo[d.logisticType ?? "otro"] ?? d.logisticType}</CeldaTabla>
            <CeldaTabla>
              <Chip estado={colorEstadoDespacho(d.status)}>{d.status ?? "—"}</Chip>
            </CeldaTabla>
            <CeldaTabla className={styles.celdaFecha}>{formatoFechaColombia(d.actualizadoTs)}</CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>
      <p className={styles.resumenPaginacion}>
        Mostrando hasta {tamanoPagina} de {total} pendientes de imprimir.
      </p>
      <Boton type="submit" className={styles.botonImprimir} disabled={enCurso}>
        Imprimir etiquetas seleccionadas
      </Boton>
      {error && <p className={styles.errorTarjeta}>{error}</p>}
      <p className={styles.nota}>
        Solo imprime lo seleccionado de esta lista. Si hay despachos de varias cuentas de Mercado Libre, selecciona primero los de una sola cuenta.
      </p>
    </form>
  );
}
