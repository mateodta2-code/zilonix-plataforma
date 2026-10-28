"use client";

import { useState } from "react";
import { confirmarMaestraAction, previsualizarMaestraAction, type EstadoImportacionMaestra } from "./actions";
import { CAMPOS_MAESTRA, ETIQUETAS_CAMPO, type CampoMaestra, type MapeoColumnas } from "@/lib/finanzas/maestra-campos";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import styles from "../../finanzas.module.css";

const CAMPOS_TEXTO: CampoMaestra[] = ["producto", "proveedor", "sku"];

function mostrarValor(campo: CampoMaestra, valor: string | null): string {
  if (valor === null) return "vacío";
  return CAMPOS_TEXTO.includes(campo) ? valor : mostrarMonto(valor);
}

// Issue #128 — subir, revisar (con las columnas detectadas y la opción
// de elegirlas a mano) y confirmar. El archivo queda en memoria del
// navegador para mandarlo otra vez al confirmar; el servidor lo vuelve
// a validar entero.
export function ImportarMaestraClient() {
  const [estado, setEstado] = useState<EstadoImportacionMaestra>({ paso: "inicial" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [mapeo, setMapeo] = useState<MapeoColumnas | null>(null);
  const [cargando, setCargando] = useState(false);

  function datosConArchivo(mapeoManual: MapeoColumnas | null): FormData | null {
    if (!archivo) return null;
    const formData = new FormData();
    formData.set("archivo", archivo);
    if (mapeoManual) formData.set("mapeo", JSON.stringify(mapeoManual));
    return formData;
  }

  async function ejecutar(accion: (f: FormData) => Promise<EstadoImportacionMaestra>, mapeoManual: MapeoColumnas | null) {
    const formData = datosConArchivo(mapeoManual);
    if (!formData) return;
    setCargando(true);
    try {
      const nuevo = await accion(formData);
      setEstado(nuevo);
      if (nuevo.paso === "revisar") setMapeo(nuevo.vistaPrevia.mapeo);
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setEstado({ paso: "inicial" });
    setArchivo(null);
    setMapeo(null);
  }

  if (estado.paso === "confirmado") {
    const { nuevas, actualizadas, sinCambios } = estado.resultado;
    return (
      <div className={styles.form}>
        <p className={styles.avisoExito}>
          Listo: <strong>{nuevas}</strong> SKU nuevo(s), <strong>{actualizadas}</strong> actualizado(s) y {sinCambios} sin cambios.
        </p>
        <div className={styles.acciones}>
          <Boton type="button" onClick={reiniciar}>
            Cargar otro archivo
          </Boton>
          <BotonLink href="/panel/finanzas/maestra-sku" variante="secundario">
            Ver la tabla maestra
          </BotonLink>
        </div>
      </div>
    );
  }

  if (estado.paso === "revisar") {
    const { filas, errores, resumen, encabezados } = estado.vistaPrevia;
    const conCambios = filas.filter((f) => f.estado !== "sin_cambios");
    const puedeConfirmar = errores.length === 0 && resumen.nuevas + resumen.cambios > 0;
    return (
      <div className={styles.form}>
        <p>
          <strong>{resumen.nuevas}</strong> nueva(s) · <strong>{resumen.cambios}</strong> con cambios · {resumen.sinCambios} sin cambios ·{" "}
          <strong>{resumen.conError}</strong> con error · {resumen.conAviso} con aviso
        </p>

        {encabezados.length > 0 && (
          <details>
            <summary className={styles.enlace}>Columnas del archivo (cámbialas si alguna no se reconoció)</summary>
            <div className={`${styles.grilla} ${styles.seccion}`}>
              {CAMPOS_MAESTRA.map((campo) => (
                <Campo key={campo} etiqueta={ETIQUETAS_CAMPO[campo]}>
                  <select
                    value={mapeo?.[campo] ?? -1}
                    onChange={(e) => setMapeo({ ...(mapeo ?? {}), [campo]: Number(e.target.value) === -1 ? undefined : Number(e.target.value) })}
                    className="zx-control"
                  >
                    <option value={-1}>No importar</option>
                    {encabezados.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Columna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </Campo>
              ))}
            </div>
            <Boton type="button" variante="secundario" chico onClick={() => ejecutar(previsualizarMaestraAction, mapeo)} disabled={cargando}>
              Revisar con estas columnas
            </Boton>
          </details>
        )}

        {errores.length > 0 && (
          <>
            <p className={styles.avisoError}>Hay filas con error: no se va a guardar ninguna hasta corregirlas (todo o nada).</p>
            <Tabla encabezados={["Fila", "Columna", "Motivo"]}>
              {errores.map((e, i) => (
                <FilaTabla key={`${e.numeroFila}-${i}`}>
                  <CeldaTabla>{e.numeroFila}</CeldaTabla>
                  <CeldaTabla>{e.columna}</CeldaTabla>
                  <CeldaTabla>{e.mensaje}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </>
        )}

        {conCambios.length > 0 && (
          <Tabla encabezados={["Fila", "SKU", "Estado", "Cambios", "Avisos"]}>
            {conCambios.map((f) => (
              <FilaTabla key={f.numeroFila}>
                <CeldaTabla>{f.numeroFila}</CeldaTabla>
                <CeldaTabla>
                  <strong>{f.sku}</strong>
                </CeldaTabla>
                <CeldaTabla>{f.estado === "nueva" ? <Chip estado="exito">Nueva</Chip> : <Chip estado="aviso">Cambio</Chip>}</CeldaTabla>
                <CeldaTabla>
                  {f.cambios.map((c) => (
                    <div key={c.campo}>
                      {ETIQUETAS_CAMPO[c.campo]}: {f.estado === "cambio" && <>{mostrarValor(c.campo, c.anterior)} → </>}
                      {mostrarValor(c.campo, c.nuevo)}
                    </div>
                  ))}
                </CeldaTabla>
                <CeldaTabla>
                  {f.avisos.map((a) => (
                    <div key={a} className={styles.suave}>
                      {a}
                    </div>
                  ))}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
        {conCambios.length === 0 && errores.length === 0 && <EstadoVacio>El archivo no cambia nada de la tabla maestra.</EstadoVacio>}

        <div className={styles.acciones}>
          <Boton type="button" onClick={() => ejecutar(confirmarMaestraAction, mapeo)} disabled={cargando || !puedeConfirmar}>
            {cargando ? "Guardando…" : `Confirmar (${resumen.nuevas + resumen.cambios})`}
          </Boton>
          <Boton type="button" variante="fantasma" onClick={reiniciar} disabled={cargando}>
            Elegir otro archivo
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
        void ejecutar(previsualizarMaestraAction, null);
      }}
    >
      {estado.paso === "error" && <p className={styles.avisoError}>{estado.mensaje}</p>}
      <Campo etiqueta="Archivo .xlsx o .csv">
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="zx-control"
        />
      </Campo>
      <p className={styles.ayuda}>
        Columnas de la hoja PRODUCTOS: PRODUCTO, PROVEEDOR, SKU, Costo producto, packing, envío agencia y Precio mínimo venta 1, 2 y 3 (y,
        opcional, precio de venta). En .xlsx se lee la hoja PRODUCTOS o, si no está, la primera. Hasta 5 MB y 5.000 filas.
      </p>
      <p className={styles.ayuda}>
        Celda vacía no cambia lo guardado; 0 sí. Costo vacío = sin costo; costo 0 = costo real. Precio mínimo 0 = no aplica. El proveedor
        tiene que existir en Proveedores. Montos con punto de miles y coma decimal (2.000 o 1.234,56).
      </p>
      <div className={styles.acciones}>
        <Boton type="submit" disabled={cargando || !archivo}>
          {cargando ? "Revisando…" : "Ver vista previa"}
        </Boton>
      </div>
    </form>
  );
}
