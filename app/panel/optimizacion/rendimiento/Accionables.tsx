"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { armarAccionables, elegirParaEnriquecer, ROTULO_ACCIONABLE, type Accionable, type ContextoItem, type SenalesItem } from "@/lib/optimizacion/accionables";
import type { PeriodoLista } from "@/lib/optimizacion/periodoLista";
import { hoyBogota } from "@/lib/publicidad/plan";
import { guardarNotaBitacoraAction } from "../actions";
import { contextoAccionablesAction, senalesAccionablesAction } from "./actions";
import { elegirCandidatas, TablaRendimiento, type DatosTraidos, type FilaRendimiento } from "./TablaRendimiento";
import styles from "./rendimiento.module.css";

export const MAXIMO_ACCIONABLES = 10;
export const MAXIMO_ENRIQUECER = 10;
const DE_A = 3;
const CLAVE_DESCARTADOS = "zx-accionables-descartados";

type Props = {
  filas: FilaRendimiento[];
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  periodo: PeriodoLista;
  // Sin ventas/consultar: se ve el orden, no la plata.
  verMontos: boolean;
  datos: DatosTraidos;
  // Query de la página para que el enlace al detalle conserve cuenta y período.
  consultaPeriodo: string;
};

const claveDescarte = (cuentaMlId: string, a: Accionable) => `${cuentaMlId}|${a.tipo}|${a.itemId}`;

export function Accionables({ filas, cuentaMlId, siteId, idioma, periodo, verMontos, datos, consultaPeriodo }: Props) {
  const [contexto, setContexto] = useState<Record<string, ContextoItem> | null>(null);
  const [senales, setSenales] = useState<Record<string, SenalesItem>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [completo, setCompleto] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [descartados, setDescartados] = useState<string[]>([]);
  const [hechos, setHechos] = useState<Record<string, string>>({});
  const iniciada = useRef<string | null>(null);

  // «Descartar» vive solo en esta pestaña del navegador (el persistente es otra tarea).
  useEffect(() => {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(CLAVE_DESCARTADOS) ?? "[]");
      if (Array.isArray(guardado)) setDescartados(guardado.filter((x): x is string => typeof x === "string"));
    } catch {
      /* sessionStorage no disponible: se descarta solo en memoria */
    }
  }, []);

  const filasAcc = useMemo(
    () => filas.map((f) => ({ itemId: f.itemId, titulo: f.titulo, ingresos: f.ingresos, porcentaje: f.porcentaje, ventas: f.ventas, impresiones: f.impresiones, clics: f.clics, visitas: datos.visitas[f.itemId] ?? null, categoria: datos.categorias[f.itemId] ?? null })),
    [filas, datos]
  );
  const entrada = (ctx: Record<string, ContextoItem>, sen: Record<string, SenalesItem>) => ({
    filas: filasAcc,
    senales: sen,
    contexto: ctx,
    diasPeriodo: periodo.dias,
    conMontos: verMontos,
    formatoMoneda: (v: number) => formatearMoneda(v, siteId),
    formatoNumero: (v: number) => formatearNumero(v, idioma),
  });

  // Cuando la tabla termina de traer visitas y categorías: contexto (1 lectura) y
  // luego señales de ML solo de las ≤ 10 publicaciones, de a 3.
  const firma = `${cuentaMlId}|${periodo.clave}|${periodo.desde}|${periodo.hasta}|${filas.length}`;
  useEffect(() => {
    if (datos.cargando || filas.length === 0 || iniciada.current === firma) return;
    iniciada.current = firma;
    let cancelado = false;
    setContexto(null);
    setSenales({});
    setAviso(null);
    setCompleto(false);
    (async () => {
      try {
        const c = await contextoAccionablesAction({ cuentaMlId, ids: elegirCandidatas(filas) });
        if (cancelado) return;
        if (!c.ok) {
          setAviso(c.aviso);
          setContexto({});
          setCompleto(true);
          return;
        }
        setContexto(c.contexto);
        if (c.avisos.length) setAviso(c.avisos.join(" "));
        const base = armarAccionables(entrada(c.contexto, {}));
        const ids = elegirParaEnriquecer(filasAcc, base, MAXIMO_ENRIQUECER);
        for (let i = 0; i < ids.length; i += DE_A) {
          if (cancelado) return;
          const r = await senalesAccionablesAction({ cuentaMlId, ids: ids.slice(i, i + DE_A) });
          if (cancelado) return;
          if (!r.ok) {
            setAviso(r.aviso);
            break;
          }
          setSenales((previas) => ({ ...previas, ...r.senales }));
        }
      } catch {
        if (!cancelado) setAviso("No se pudieron traer las señales de Mercado Libre. Actualiza la página para reintentar.");
      }
      if (!cancelado) setCompleto(true);
    })();
    return () => {
      cancelado = true;
      iniciada.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.cargando, firma]);

  const lista = useMemo(
    () => (contexto ? armarAccionables(entrada(contexto, senales)).filter((a) => !descartados.includes(claveDescarte(cuentaMlId, a))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contexto, senales, filasAcc, descartados, verMontos]
  );
  const visibles = verTodos ? lista : lista.slice(0, MAXIMO_ACCIONABLES);

  function descartar(a: Accionable) {
    const nuevos = [...descartados, claveDescarte(cuentaMlId, a)];
    setDescartados(nuevos);
    try {
      sessionStorage.setItem(CLAVE_DESCARTADOS, JSON.stringify(nuevos));
    } catch {
      /* solo en memoria */
    }
  }

  async function marcarHecho(a: Accionable) {
    const clave = claveDescarte(cuentaMlId, a);
    const r = await guardarNotaBitacoraAction({ cuentaMlId, itemId: a.itemId, fecha: hoyBogota(new Date()), texto: `Accionable hecho: ${ROTULO_ACCIONABLE[a.tipo]}` }).catch(() => ({ ok: false as const, aviso: "No se pudo guardar. Reintenta." }));
    setHechos((h) => ({ ...h, [clave]: r.aviso }));
    if (r.ok) descartar(a);
  }

  return (
    <section className={styles.accionables} aria-labelledby="que-hacer-primero">
      <h2 id="que-hacer-primero" className={styles.accionablesTitulo}>
        Qué hacer primero
      </h2>
      <p className={styles.nota}>
        {verMontos
          ? "Ordenado por la plata que podrías estar dejando de ganar en el período. Son estimaciones: cada tarjeta dice qué números usó."
          : "Ordenado por lo que más pesa en tus ingresos. No ves montos porque tu rol no tiene permiso de ventas."}
      </p>
      {!completo ? <p className={styles.nota}>{datos.cargando ? "Esperando visitas y categorías…" : "Calculando accionables…"}</p> : null}
      {aviso ? <p className={styles.avisoError}>{aviso}</p> : null}
      {completo && lista.length === 0 ? <p className={styles.nota}>No hay nada urgente en este período. 🎉</p> : null}
      <ul className={styles.accionablesLista}>
        {visibles.map((a) => {
          const clave = claveDescarte(cuentaMlId, a);
          return (
            <li key={clave} className={styles.accionable}>
              <div className={styles.accionableCabecera}>
                <Chip estado={a.tipo === "preguntas" || a.tipo === "calidad" ? "neutro" : "aviso"}>{ROTULO_ACCIONABLE[a.tipo]}</Chip>
                <Link className={styles.enlace} href={`/panel/optimizacion/${a.itemId}?cuenta=${cuentaMlId}${consultaPeriodo ? `&${consultaPeriodo}` : ""}`}>
                  {a.titulo}
                </Link>
                {verMontos ? <span className={styles.accionableMonto}>{a.monto !== null ? formatearMoneda(Number(a.monto), siteId) : "Sin estimar"}</span> : null}
              </div>
              <p className={styles.accionablePorQue}>
                <strong>Por qué: </strong>
                {a.explicacion}
              </p>
              <div className={styles.accionableAcciones}>
                {a.tipo === "preguntas" ? (
                  <Link className={styles.enlace} href="/panel/preguntas">
                    Ir a la bandeja de preguntas
                  </Link>
                ) : (
                  // Puente directo a «Editar en Mercado Libre» (título, portada, galería, precio, stock).
                  <BotonLink chico href={`/panel/optimizacion/${a.itemId}?cuenta=${cuentaMlId}${consultaPeriodo ? `&${consultaPeriodo}` : ""}#editar`}>
                    Ir a la publicación
                  </BotonLink>
                )}
                <Boton variante="secundario" chico type="button" onClick={() => marcarHecho(a)}>
                  Marcar hecho
                </Boton>
                <Boton variante="fantasma" chico type="button" onClick={() => descartar(a)}>
                  Descartar
                </Boton>
              </div>
              {hechos[clave] ? <span className={styles.notaNeutra}>{hechos[clave]}</span> : null}
            </li>
          );
        })}
      </ul>
      {lista.length > MAXIMO_ACCIONABLES ? (
        <Boton variante="fantasma" chico type="button" onClick={() => setVerTodos((v) => !v)}>
          {verTodos ? "Ver solo los 10 primeros" : `Ver todos (${formatearNumero(lista.length, idioma)})`}
        </Boton>
      ) : null}
    </section>
  );
}

// Tabla + «Qué hacer primero» comparten lo que la tabla ya trae de Mercado Libre.
export function RendimientoConAccionables(props: Omit<Props, "datos"> & { grupo: React.ComponentProps<typeof TablaRendimiento>["grupo"] }) {
  const [datos, setDatos] = useState<DatosTraidos>({ visitas: {}, categorias: {}, cargando: true });
  const { grupo, verMontos, consultaPeriodo, ...tabla } = props;
  return (
    <>
      <Accionables {...tabla} verMontos={verMontos} consultaPeriodo={consultaPeriodo} datos={datos} />
      <TablaRendimiento filas={tabla.filas} grupo={grupo} cuentaMlId={tabla.cuentaMlId} siteId={tabla.siteId} idioma={tabla.idioma} periodo={tabla.periodo} alCambiarDatos={setDatos} />
    </>
  );
}
