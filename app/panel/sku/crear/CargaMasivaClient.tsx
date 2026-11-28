"use client";

import { useState } from "react";
import Link from "next/link";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { confirmarCargaMasivaAction, previsualizarCargaMasivaAction, type EstadoCargaMasiva } from "./actions";
import styles from "./page.module.css";

type BodegaOpcion = { id: string; nombre: string; esPrincipal: boolean };
// Lo que la persona mandó: al confirmar se reenvía tal cual (el
// servidor lo vuelve a leer y validar desde cero).
type Entrada = { texto: string; archivo: File | null; bodegaId: string };

// Mismo flujo de /panel/sku/importar (ImportarCsvSkusClient): inicial →
// revisar → confirmado, con las acciones llamadas directo (React 18).
export function CargaMasivaClient({ bodegas }: { bodegas: BodegaOpcion[] }) {
  const [estado, setEstado] = useState<EstadoCargaMasiva>({ paso: "inicial" });
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [cargando, setCargando] = useState(false);
  const [creando, setCreando] = useState(false);

  function formDataDe(e: Entrada): FormData {
    const datos = new FormData();
    if (e.archivo) datos.set("archivo", e.archivo);
    else datos.set("texto", e.texto);
    datos.set("bodegaId", e.bodegaId);
    return datos;
  }

  async function alPrevisualizar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    const archivo = form.get("archivo");
    const nueva: Entrada = {
      texto: String(form.get("texto") ?? ""),
      archivo: archivo instanceof File && archivo.size > 0 ? archivo : null,
      bodegaId: String(form.get("bodegaId") ?? ""),
    };
    setEntrada(nueva);
    setCreando(false);
    setCargando(true);
    try {
      setEstado(await previsualizarCargaMasivaAction(formDataDe(nueva)));
    } finally {
      setCargando(false);
    }
  }

  async function alConfirmar() {
    if (estado.paso !== "revisar" || !entrada) return;
    const datos = formDataDe(entrada);
    datos.set("cargaId", estado.cargaId);
    setCreando(true);
    setCargando(true);
    try {
      setEstado(await confirmarCargaMasivaAction(datos));
    } finally {
      setCargando(false);
    }
  }

  const barra = (
    <BarraCarga estado={cargando ? "cargando" : "inactiva"} titulo={creando ? "Creando productos…" : "Revisando la carga…"} avance={null} sticky={false} />
  );

  if (estado.paso === "confirmado") {
    const { creados, unidades, omitidos, yaConfirmada } = estado.resultado;
    return (
      <div className={styles.pila}>
        <p className={styles.resumen}>
          {yaConfirmada ? "Esta carga ya estaba confirmada. " : ""}
          Listo: <strong>{creados}</strong> productos creados, <strong>{unidades}</strong> unidades cargadas, <strong>{omitidos}</strong> omitidos por
          error.
        </p>
        <div className={styles.acciones}>
          <Boton type="button" onClick={() => setEstado({ paso: "inicial" })}>
            Hacer otra carga
          </Boton>
        </div>
      </div>
    );
  }

  if (estado.paso === "revisar") {
    const { lineas, resumen, columnasIgnoradas, bodegaNombre } = estado.vista;
    return (
      <div className={styles.pila}>
        <p className={styles.resumen}>
          <strong>{resumen.listas}</strong> listas · <strong>{resumen.conError}</strong> con error
          {resumen.unidades > 0 && (
            <>
              {" "}
              · {resumen.unidades} unidades de inventario inicial{bodegaNombre ? ` en ${bodegaNombre}` : ""}
            </>
          )}
        </p>
        {columnasIgnoradas.length > 0 && <p className={styles.detalle}>Columnas que no se leen (se ignoran): {columnasIgnoradas.join(", ")}.</p>}
        <Tabla
          encabezados={["Línea", "SKU", "Nombre", { clave: "costo", contenido: "Costo", numerica: true }, { clave: "precio", contenido: "Precio", numerica: true }, { clave: "stock", contenido: "Stock", numerica: true }, "Estado"]}
          scroll
        >
          {lineas.map((l) => (
            <FilaTabla key={l.numeroLinea}>
              <CeldaTabla>{l.numeroLinea}</CeldaTabla>
              <CeldaTabla>
                {l.codigo ? <strong>{l.codigo}</strong> : "—"}
                {l.automatico && <span className={styles.detalle}> automático</span>}
              </CeldaTabla>
              <CeldaTabla>{l.nombre || "—"}</CeldaTabla>
              <CeldaTabla numerica>{l.estado === "nuevo" ? mostrarMonto(l.costo) : (l.costo ?? "—")}</CeldaTabla>
              <CeldaTabla numerica>{l.estado === "nuevo" ? mostrarMonto(l.precio) : (l.precio ?? "—")}</CeldaTabla>
              <CeldaTabla numerica>{l.stock || "0"}</CeldaTabla>
              <CeldaTabla>
                {l.estado === "nuevo" ? (
                  <Chip estado="exito">Nuevo</Chip>
                ) : (
                  <>
                    <Chip estado="peligro">Error</Chip>
                    <span className={styles.motivo}>{l.motivos.join(" ")}</span>
                  </>
                )}
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
        {barra}
        {resumen.listas === 0 ? (
          <>
            <EstadoVacio>No hay ninguna línea válida para crear: corrige los errores y vuelve a intentarlo.</EstadoVacio>
            <div className={styles.acciones}>
              <Boton type="button" variante="fantasma" onClick={() => setEstado({ paso: "inicial" })}>
                Volver
              </Boton>
            </div>
          </>
        ) : (
          <>
            {resumen.conError > 0 && (
              <p className={styles.advertencia}>
                Se crearán {resumen.listas} y se omitirán {resumen.conError} con error.
              </p>
            )}
            <div className={styles.acciones}>
              <Boton type="button" onClick={alConfirmar} disabled={cargando}>
                {cargando ? "Creando…" : `Confirmar y crear (${resumen.listas})`}
              </Boton>
              <Boton type="button" variante="fantasma" onClick={() => setEstado({ paso: "inicial" })} disabled={cargando}>
                Cambiar la carga
              </Boton>
            </div>
          </>
        )}
      </div>
    );
  }

  const principal = bodegas.find((b) => b.esPrincipal)?.id ?? bodegas[0]?.id ?? "";
  return (
    <form onSubmit={alPrevisualizar} className={styles.pila}>
      {estado.paso === "error" && <p className={styles.error}>{estado.mensaje}</p>}
      <p className={styles.detalle}>
        Una línea por producto: <code>sku;nombre;costo;precio;stock</code>. SKU vacío = se genera automático. Encabezado opcional (si la primera
        línea dice «nombre»). Hasta 1000 productos por carga. Esta carga no actualiza productos que ya existen.
      </p>
      <p className={styles.detalle}>
        Si usas coma como separador, escribe los montos sin separador de miles (2500 o 2500.50); con ; o tabulación puedes escribir 2.500,50.
      </p>
      <Campo etiqueta="Pegar líneas">
        <textarea
          name="texto"
          rows={6}
          className="zx-control"
          defaultValue={entrada?.archivo ? "" : (entrada?.texto ?? "")}
          placeholder={"SKU-001;Linterna recargable;5000;12900;10\n;Camping lámpara;8.000;19.900;5"}
        />
      </Campo>
      <div className={styles.filaForm}>
        <Campo etiqueta="O subir archivo (.csv o .xlsx)">
          <input type="file" name="archivo" accept=".csv,.xlsx" className="zx-control" />
        </Campo>
        <Campo etiqueta="Bodega del stock inicial">
          <select name="bodegaId" className="zx-control" defaultValue={entrada?.bodegaId ?? principal}>
            <option value="">— Sin stock inicial —</option>
            {bodegas.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
                {b.esPrincipal ? " (principal)" : ""}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      {barra}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={cargando}>
          {cargando ? "Revisando…" : "Ver vista previa"}
        </Boton>
        <Link href="/panel/sku/importar" className={styles.enlace}>
          ¿Solo tienes SKU y cantidad? Usa Importar CSV
        </Link>
      </div>
    </form>
  );
}
