"use client";

import { useMemo, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import type { Bloque } from "@/lib/ml/listadoCliente";
import { datosSitioMl, formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { ETIQUETA_APROXIMADO } from "@/lib/seguimiento/aproximados";
import {
  COLUMNA_ORDEN_DEFECTO,
  construirFilasNicho,
  direccionInicial,
  formatearAntiguedad,
  ordenarFilasNicho,
  terminosDeBloques,
  totalesNicho,
  type ColumnaNicho,
  type DireccionOrden,
  type FilaNicho,
} from "@/lib/ml/tablaNicho";
import styles from "./page.module.css";

const COLUMNAS: { clave: ColumnaNicho; etiqueta: string; numerica?: boolean }[] = [
  { clave: "orden", etiqueta: "#" },
  { clave: "foto", etiqueta: "Imagen" },
  { clave: "titulo", etiqueta: "Publicación" },
  { clave: "precio", etiqueta: "Precio", numerica: true },
  { clave: "origen", etiqueta: "Origen" },
  { clave: "antiguedad", etiqueta: "Antigüedad", numerica: true },
  { clave: "ventasMes", etiqueta: "Ventas/mes", numerica: true },
  { clave: "factMes", etiqueta: "Fact./mes", numerica: true },
];

const TODOS = "__todos__";

export function TablaNicho({
  bloques,
  ahora,
  hayExtension,
  onCompletarVendidos,
}: {
  bloques: Bloque[];
  ahora: Date;
  hayExtension: boolean;
  onCompletarVendidos: (filas: FilaNicho[]) => void;
}) {
  const [termino, setTermino] = useState<string>(TODOS);
  const [columna, setColumna] = useState<ColumnaNicho>(COLUMNA_ORDEN_DEFECTO);
  const [direccion, setDireccion] = useState<DireccionOrden>("desc");
  const [fotosFallidas, setFotosFallidas] = useState<Set<string>>(new Set());

  const terminos = useMemo(() => terminosDeBloques(bloques), [bloques]);
  const terminoActivo = terminos.includes(termino) ? termino : TODOS;
  // Las filas se recalculan de `bloques`: al llegar un "Completar vendidos" la fila se actualiza sola.
  const filas = useMemo(() => construirFilasNicho(bloques, ahora, terminoActivo === TODOS ? null : terminoActivo), [bloques, ahora, terminoActivo]);
  const ordenadas = useMemo(() => ordenarFilasNicho(filas, columna, direccion), [filas, columna, direccion]);
  const totales = useMemo(() => totalesNicho(filas), [filas]);
  const sitio = datosSitioMl(totales.siteId);
  const faltantes = filas.filter((f) => f.faltaVendidos);

  if (!filas.length) return null;

  function clicEncabezado(c: ColumnaNicho) {
    if (c === columna) setDireccion((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setColumna(c);
      setDireccion(direccionInicial(c));
    }
  }

  const encabezados: EncabezadoTabla[] = COLUMNAS.map((c) => ({
    clave: c.clave,
    numerica: c.numerica,
    ariaSort: c.clave === columna ? (direccion === "asc" ? "ascending" : "descending") : "none",
    contenido: (
      <button type="button" className={styles.encabezadoOrden} onClick={() => clicEncabezado(c.clave)}>
        {c.etiqueta}
        {c.clave === columna ? (direccion === "asc" ? " ▲" : " ▼") : ""}
      </button>
    ),
  }));

  const num = (n: number, siteId: string) => formatearNumero(Math.round(n), datosSitioMl(siteId).idioma);
  const sinDato = <span title="Sin dato real: no se estima">—</span>;

  return (
    <details className={styles.bloque} open>
      <summary className={styles.tituloSeccion} style={{ cursor: "pointer" }}>
        Análisis del nicho ({filas.length})
      </summary>
      <div className={styles.encabezadoBloque}>
        <select className="zx-control" aria-label="Término" value={terminoActivo} onChange={(e) => setTermino(e.target.value)}>
          <option value={TODOS}>Todos los términos</option>
          {terminos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {hayExtension && faltantes.length > 0 ? (
          <Boton type="button" variante="secundario" chico onClick={() => onCompletarVendidos(faltantes)}>
            Completar vendidos
          </Boton>
        ) : null}
      </div>

      <div className={styles.kpis}>
        <TarjetaKpi titulo="VENDIDOS (HISTÓRICO)" valor={totales.vendidos != null ? num(totales.vendidos, totales.siteId) : undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo={`VENTAS/MES EST. (${ETIQUETA_APROXIMADO})`} valor={totales.ventasMes != null ? num(totales.ventasMes, totales.siteId) : undefined} textoVacio="Sin dato" />
        <TarjetaKpi
          titulo={`FACTURACIÓN MENSUAL EST. (${ETIQUETA_APROXIMADO})`}
          valor={totales.factMes != null ? formatearMoneda(totales.factMes, totales.siteId) : undefined}
          textoVacio="Sin dato"
        />
      </div>
      {totales.hayOtrosPaises ? <p className={styles.notaInsignia}>Hay publicaciones de varios países: los totales suman solo {sitio.nombre} ({sitio.moneda}).</p> : null}

      <Tabla encabezados={encabezados}>
        {ordenadas.map((f, i) => (
          <FilaTabla key={f.clave}>
            <CeldaTabla>{i + 1}</CeldaTabla>
            <CeldaTabla>
              {f.foto && !fotosFallidas.has(f.foto) ? (
                // eslint-disable-next-line @next/next/no-img-element -- foto de un marketplace ajeno, mismo criterio que el resto del panel
                <img src={f.foto} alt="" referrerPolicy="no-referrer" className={styles.foto} onError={() => setFotosFallidas((s) => new Set(s).add(f.foto as string))} />
              ) : (
                sinDato
              )}
            </CeldaTabla>
            <CeldaTabla>
              {f.link ? (
                <a href={f.link} target="_blank" rel="noreferrer" className={styles.enlaceSeguir} style={{ whiteSpace: "normal" }}>
                  {f.titulo}
                </a>
              ) : (
                f.titulo
              )}
            </CeldaTabla>
            <CeldaTabla numerica>{formatearMoneda(f.precio, f.siteId)}</CeldaTabla>
            <CeldaTabla>{f.origen ? <Chip estado="exito">{f.origen}</Chip> : sinDato}</CeldaTabla>
            <CeldaTabla numerica>{f.antiguedadDias != null ? formatearAntiguedad(f.antiguedadDias, datosSitioMl(f.siteId).idioma) : sinDato}</CeldaTabla>
            <CeldaTabla numerica>
              {f.ventasMes != null ? (
                <>
                  {num(f.ventasMes, f.siteId)} <Chip>{ETIQUETA_APROXIMADO}</Chip>
                </>
              ) : (
                sinDato
              )}
            </CeldaTabla>
            <CeldaTabla numerica>
              {f.factMes != null ? (
                <>
                  {formatearMoneda(f.factMes, f.siteId)} <Chip>{ETIQUETA_APROXIMADO}</Chip>
                </>
              ) : (
                sinDato
              )}
            </CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>
    </details>
  );
}
