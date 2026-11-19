"use client";

import { useState } from "react";
import { importarReporteFalabellaAction, type EstadoImportacionReporte } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import styles from "../../finanzas.module.css";

// Issue #422 — subir el reporte y mostrar qué entró, qué se repitió y
// qué líneas no se reconocieron.
export function ImportarReporteClient() {
  const [estado, setEstado] = useState<EstadoImportacionReporte>({ paso: "inicial" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);

  async function importar() {
    if (!archivo) return;
    const formData = new FormData();
    formData.set("archivo", archivo);
    setCargando(true);
    try {
      setEstado(await importarReporteFalabellaAction(formData));
    } finally {
      setCargando(false);
    }
  }

  if (estado.paso === "listo") {
    const { cuenta, nuevas, repetidas, noReconocidas, tiposSinCategoria } = estado.resultado;
    return (
      <div className={styles.form}>
        <p className={styles.avisoExito}>
          Listo, cuenta <strong>{cuenta}</strong>: <strong>{nuevas}</strong> línea(s) nueva(s) y {repetidas} repetida(s) (ya estaban; solo se actualizó
          su estado de pago).
        </p>
        {tiposSinCategoria.length > 0 && (
          <p className={styles.aviso}>
            Estos tipos de transacción entraron como «Otros» porque todavía no sabemos en qué grupo van: {tiposSinCategoria.join(", ")}. Avísanos para
            clasificarlos.
          </p>
        )}
        {noReconocidas.length > 0 && (
          <>
            <p className={styles.avisoError}>{noReconocidas.length} línea(s) no se reconocieron y no se guardaron:</p>
            <Tabla encabezados={["Fila", "Motivo"]}>
              {noReconocidas.map((l) => (
                <FilaTabla key={l.numeroFila}>
                  <CeldaTabla>{l.numeroFila}</CeldaTabla>
                  <CeldaTabla>{l.motivo}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </>
        )}
        <div className={styles.acciones}>
          <BotonLink href="/panel/finanzas/falabella">Ver la conciliación</BotonLink>
          <Boton
            type="button"
            variante="secundario"
            onClick={() => {
              setEstado({ paso: "inicial" });
              setArchivo(null);
            }}
          >
            Cargar otro reporte
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void importar();
      }}
    >
      {estado.paso === "error" && <p className={styles.avisoError}>{estado.mensaje}</p>}
      <p className={styles.ayuda}>
        Descárgalo en Falabella Seller Center → Pagos → Estado de cuenta → «Reporte de transacciones», por corte o por periodo. Súbelo tal como lo
        descargas, sin cambiarle columnas. Si lo vuelves a subir, las líneas que ya estaban no se duplican.
      </p>
      <Campo etiqueta="Reporte de transacciones (.xlsx)">
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="zx-control"
        />
      </Campo>
      <div className={styles.acciones}>
        <Boton type="submit" disabled={cargando || !archivo}>
          {cargando ? "Cargando…" : "Cargar reporte"}
        </Boton>
      </div>
    </form>
  );
}
