"use client";

import { useState } from "react";
import Link from "next/link";
import { confirmarImportacionAction, previsualizarImportacionAction, type EstadoImportacion } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import styles from "./page.module.css";

export function ImportarCsvSkusClient() {
  const [estado, setEstado] = useState<EstadoImportacion>({ paso: "inicial" });
  const [cargando, setCargando] = useState(false);

  async function alSubirArchivo(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formData = new FormData(evento.currentTarget);
    setCargando(true);
    try {
      setEstado(await previsualizarImportacionAction(formData));
    } finally {
      setCargando(false);
    }
  }

  async function alConfirmar() {
    if (estado.paso !== "revisar") return;
    const formData = new FormData();
    formData.set("csvTexto", estado.csvTexto);
    setCargando(true);
    try {
      setEstado(await confirmarImportacionAction(formData));
    } finally {
      setCargando(false);
    }
  }

  function volverAlInicio() {
    setEstado({ paso: "inicial" });
  }

  if (estado.paso === "confirmado") {
    const { creados, actualizados, sinCambios, omitidosPorError } = estado.resultado;
    return (
      <div className={styles.resultadoFinal}>
        <p className={styles.resumenFinal}>
          Listo: <strong>{creados}</strong> SKU creado(s), <strong>{actualizados}</strong> actualizado(s)
          {sinCambios > 0 && (
            <>
              , <strong>{sinCambios}</strong> sin cambios (ya existían y la fila no traía nombre)
            </>
          )}
          {omitidosPorError > 0 && (
            <>
              , <strong>{omitidosPorError}</strong> fila(s) con error omitida(s)
            </>
          )}
          .
        </p>
        <div className={styles.accionesResultado}>
          <Boton type="button" onClick={volverAlInicio}>
            Importar otro archivo
          </Boton>
          <BotonLink href="/panel/sku" variante="secundario">
            Ver SKU
          </BotonLink>
        </div>
      </div>
    );
  }

  if (estado.paso === "revisar") {
    const { filas, errores, resumen } = estado.vistaPrevia;
    return (
      <div className={styles.revision}>
        <p className={styles.resumenRevision}>
          <strong>{resumen.validas}</strong> fila(s) válida(s) ({resumen.nuevos} nuevo(s), {resumen.existentes} ya existe(n)) ·{" "}
          <strong>{resumen.conError}</strong> fila(s) con error
          {resumen.skusRepetidos.length > 0 && <> · SKU repetidos en el archivo: {resumen.skusRepetidos.join(", ")}</>}
        </p>

        {filas.length > 0 && (
          <>
            <p className={styles.notaStock}>
              La cantidad inicial y la bodega se muestran tal cual vienen en el archivo, pero todavía no se guardan en ningún lado — el
              movimiento de stock de la importación queda pendiente de Z-ML-06 (issue #57).
            </p>
            <Tabla encabezados={["SKU", "Nombre", "Bodega", "Cantidad inicial", "Estado"]}>
              {filas.map((fila) => (
                <FilaTabla key={fila.sku}>
                  <CeldaTabla>
                    <strong>{fila.sku}</strong>
                  </CeldaTabla>
                  <CeldaTabla>{fila.nombre ?? <span className={styles.vacioCelda}>— (usa el código)</span>}</CeldaTabla>
                  <CeldaTabla>{fila.bodega ?? "—"}</CeldaTabla>
                  <CeldaTabla>{fila.cantidadInicial}</CeldaTabla>
                  <CeldaTabla>
                    {fila.yaExiste ? <Chip estado="aviso">Ya existe</Chip> : <Chip estado="exito">Nuevo</Chip>}
                  </CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </>
        )}

        {errores.length > 0 && (
          <>
            <p className={styles.tituloErrores}>Filas con error (no se van a importar):</p>
            <Tabla encabezados={["Fila", "Columna", "Motivo"]}>
              {errores.map((error, indice) => (
                <FilaTabla key={`${error.numeroFila}-${error.columna}-${indice}`}>
                  <CeldaTabla>{error.numeroFila}</CeldaTabla>
                  <CeldaTabla>{error.columna}</CeldaTabla>
                  <CeldaTabla>{error.mensaje}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </>
        )}

        {filas.length === 0 ? (
          <EstadoVacio>El archivo no tiene ninguna fila válida para importar.</EstadoVacio>
        ) : (
          <div className={styles.accionesRevision}>
            <Boton type="button" onClick={alConfirmar} disabled={cargando}>
              {cargando ? "Importando…" : `Confirmar importación (${resumen.validas})`}
            </Boton>
            <Boton type="button" variante="fantasma" onClick={volverAlInicio} disabled={cargando}>
              Elegir otro archivo
            </Boton>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={alSubirArchivo} className={styles.formSubida}>
      {estado.paso === "error" && <p className={styles.error}>{estado.mensaje}</p>}
      <label className={styles.campoArchivo}>
        <span className={styles.etiquetaArchivo}>Archivo CSV</span>
        <input type="file" name="archivo" accept=".csv,text/csv" required className="zx-control" />
      </label>
      <p className={styles.ayuda}>
        Columnas: <code>sku</code> y <code>cantidad_inicial</code> (obligatorias), <code>nombre</code> y <code>bodega</code> (opcionales). Hasta
        5 MB y 20.000 filas.
      </p>
      <Boton type="submit" disabled={cargando}>
        {cargando ? "Revisando…" : "Ver vista previa"}
      </Boton>
    </form>
  );
}
