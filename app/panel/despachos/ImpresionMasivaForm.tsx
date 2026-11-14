"use client";

import { useRef, useState } from "react";
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
  // Solo en modo "reimprimir": cuándo se imprimió.
  etiquetaImpresaTs?: Date | null;
  // "2 x Gorra azul · 1 x Camiseta" — qué va en el paquete, para saber
  // qué guía es cuál sin abrir la tarjeta.
  producto?: string | null;
  // Estado ya traducido (etiquetaEstadoEnvio) — el crudo
  // ("ready_to_ship") solo si no hay traducción.
  estado?: string | null;
};

// Un form por cuenta de Mercado Libre (la página agrupa así): una sola
// llamada a /shipment_labels no puede mezclar cuentas, y con todas las
// filas juntas y marcadas el lote fallaba de entrada ("Elige despachos
// de una sola cuenta") sin forma de saber cuál era de cuál.
export type ImpresionMasivaFormProps = {
  filas: FilaImpresionMasiva[];
  etiquetaTipo: Record<string, string>;
  // "reimprimir" (2026-11-13): mismo form para las guías YA impresas —
  // casillas desmarcadas (se elige qué volver a imprimir) y fecha de
  // impresión. El Route Handler valida contra
  // listarDespachosYaImpresos en vez de los pendientes.
  modo?: "pendientes" | "reimprimir";
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
export function ImpresionMasivaForm({ filas, etiquetaTipo, modo = "pendientes" }: ImpresionMasivaFormProps) {
  const reimprimir = modo === "reimprimir";
  // Qué botón se usó: "Imprimir" (formato de Mercado Libre) o
  // "Imprimir en sticker 10x15" — se guarda al hacer clic porque el
  // FormData del submit no trae el botón que lo disparó.
  const formato = useRef<"normal" | "sticker">("normal");
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnCurso(true);
    setError(null);
    try {
      const datosForm = new FormData(evento.currentTarget);
      datosForm.set("formato", formato.current);
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
      {reimprimir && <input type="hidden" name="modo" value="reimprimir" />}
      <Tabla encabezados={reimprimir ? ["", "Envío", "Producto", "Tipo", "Impresa"] : ["", "Envío", "Producto", "Tipo", "Estado", "Actualizado"]}>
        {filas.map((d) => (
          <FilaTabla key={d.id}>
            <CeldaTabla>
              <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked={!reimprimir} aria-label={`Seleccionar envío ${d.shipmentIdExterno}`} />
            </CeldaTabla>
            <CeldaTabla>#{d.shipmentIdExterno}</CeldaTabla>
            <CeldaTabla>{d.producto ?? "—"}</CeldaTabla>
            <CeldaTabla>{etiquetaTipo[d.logisticType ?? "otro"] ?? d.logisticType}</CeldaTabla>
            {reimprimir ? (
              <CeldaTabla className={styles.celdaFecha}>{d.etiquetaImpresaTs ? formatoFechaColombia(d.etiquetaImpresaTs) : "—"}</CeldaTabla>
            ) : (
              <>
                <CeldaTabla>
                  <Chip estado={colorEstadoDespacho(d.status)}>{d.estado ?? d.status ?? "—"}</Chip>
                </CeldaTabla>
                <CeldaTabla className={styles.celdaFecha}>{formatoFechaColombia(d.actualizadoTs)}</CeldaTabla>
              </>
            )}
          </FilaTabla>
        ))}
      </Tabla>
      <div className={styles.botonesImpresion}>
        <Boton type="submit" className={styles.botonImprimir} disabled={enCurso} onClick={() => (formato.current = "normal")}>
          {reimprimir ? "Reimprimir seleccionadas" : "Imprimir etiquetas seleccionadas"}
        </Boton>
        <Boton type="submit" variante="secundario" className={styles.botonImprimir} disabled={enCurso} onClick={() => (formato.current = "sticker")}>
          {reimprimir ? "Reimprimir en sticker 10x15" : "Imprimir en sticker 10x15"}
        </Boton>
      </div>
      {error && <p className={styles.errorTarjeta}>{error}</p>}
      {reimprimir && (
        <p className={styles.nota}>Marca las guías que quieres volver a imprimir. Solo aparecen las que Mercado Libre todavía deja imprimir y no se han marcado como despachadas.</p>
      )}
    </form>
  );
}
