"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Chip } from "@/components/marco/Chip";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import type { PeriodoLista } from "@/lib/optimizacion/periodoLista";
import {
  AVISO_NO_CONCILIA,
  medianasPorCategoria,
  ROTULO_GRUPO,
  semaforoPublicacion,
  traficoAds,
  type EntradaMediana,
  type GrupoPareto,
  type TonoSemaforo,
} from "@/lib/optimizacion/rendimiento";
import { categoriasRendimientoAction, visitasRendimientoAction } from "./actions";
import styles from "./rendimiento.module.css";

export type FilaRendimiento = {
  itemId: string;
  titulo: string | null;
  foto: string | null;
  sku: string | null;
  grupo: GrupoPareto;
  porcentaje: number;
  acumulado: number | null;
  // null = sin permiso ventas/consultar: solo se ven los porcentajes.
  ingresos: number | null;
  ventas: number;
  // null = la cuenta no tiene Product Ads («Sin Ads»).
  clics: number | null;
  impresiones: number | null;
};

// Tope de publicaciones a las que se les piden visitas y categoría: las de
// más ingresos y luego las de más impresiones.
export const MAXIMO_PUBLICACIONES = 100;
export const EN_PARALELO = 3;
export const POR_PAGINA = 50;

type ColumnaOrden = "ingresos" | "conversion" | "ctr" | "ads";
type Orden = { columna: ColumnaOrden; asc: boolean };

const ROTULO_TONO: Record<TonoSemaforo, string> = { exito: "Bien", advertencia: "Atención", peligro: "Bajo", neutro: "Poca muestra" };

export function elegirCandidatas(filas: FilaRendimiento[]): string[] {
  return [...filas]
    .sort((a, b) => b.porcentaje - a.porcentaje || (b.impresiones ?? 0) - (a.impresiones ?? 0))
    .slice(0, MAXIMO_PUBLICACIONES)
    .map((f) => f.itemId);
}

export type DatosTraidos = { visitas: Record<string, number | null>; categorias: Record<string, string>; cargando: boolean };

export function TablaRendimiento({
  filas,
  grupo,
  cuentaMlId,
  siteId,
  idioma,
  periodo,
  alCambiarDatos,
}: {
  filas: FilaRendimiento[];
  // Filtro de ?grupo=; las medianas siempre salen de toda la cuenta.
  grupo: GrupoPareto | null;
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  periodo: PeriodoLista;
  // «Qué hacer primero» reusa lo ya traído (visitas y categorías): sin
  // llamadas extra a Mercado Libre para esos datos.
  alCambiarDatos?: (datos: DatosTraidos) => void;
}) {
  const [visitas, setVisitas] = useState<Record<string, number | null>>({});
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [hechas, setHechas] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>({ columna: "ingresos", asc: false });
  const [pagina, setPagina] = useState(1);

  const candidatas = useMemo(() => elegirCandidatas(filas), [filas]);
  // Firma estable: cambiar de grupo (misma data) no vuelve a pedir nada a ML.
  const firma = `${cuentaMlId}|${periodo.clave}|${periodo.desde}|${periodo.hasta}|${candidatas.join(",")}`;

  useEffect(() => {
    let cancelado = false;
    setVisitas({});
    setCategorias({});
    setHechas(0);
    setAviso(null);
    setCargando(true);
    (async () => {
      try {
        // 1) Categorías: una llamada (hasta 5 multigets de 20 en el servidor).
        const c = await categoriasRendimientoAction({ cuentaMlId, ids: candidatas });
        if (cancelado) return;
        if (c.ok) setCategorias(c.categorias);
        else setAviso(c.aviso);
        // 2) Visitas: de a 3, y si falla, la tabla sigue con «—».
        for (let i = 0; i < candidatas.length; i += EN_PARALELO) {
          if (cancelado) return;
          const r = await visitasRendimientoAction({
            cuentaMlId,
            ids: candidatas.slice(i, i + EN_PARALELO),
            ...(periodo.clave === "hoy" || periodo.clave === "rango" ? { periodo: { desde: periodo.desde, hasta: periodo.hasta } } : { dias: periodo.dias }),
          });
          if (cancelado) return;
          if (!r.ok) {
            setAviso(r.aviso);
            break;
          }
          setVisitas((previas) => ({ ...previas, ...r.visitas }));
          setHechas(Math.min(i + EN_PARALELO, candidatas.length));
        }
      } catch {
        if (!cancelado) setAviso("No se pudieron traer visitas y categorías de Mercado Libre. Actualiza la página para reintentar.");
      }
      if (!cancelado) setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  useEffect(() => {
    alCambiarDatos?.({ visitas, categorias, cargando });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitas, categorias, cargando]);

  const entradas = useMemo(
    () =>
      new Map<string, EntradaMediana>(
        filas.map((f) => [f.itemId, { categoria: categorias[f.itemId] ?? null, impresiones: f.impresiones, clics: f.clics, visitas: visitas[f.itemId] ?? null, ventas: f.ventas }])
      ),
    [filas, categorias, visitas]
  );
  const medianas = useMemo(() => medianasPorCategoria([...entradas.values()]), [entradas]);

  const calculadas = useMemo(
    () =>
      filas.map((f) => {
        const e = entradas.get(f.itemId)!;
        return {
          fila: f,
          visitas: e.visitas,
          conversion: semaforoPublicacion(e, medianas, "cvr"),
          ctr: semaforoPublicacion(e, medianas, "ctr"),
          ads: traficoAds(f.clics, e.visitas),
        };
      }),
    [filas, entradas, medianas]
  );

  const visibles = useMemo(() => {
    const lista = grupo ? calculadas.filter((c) => c.fila.grupo === grupo) : calculadas;
    const valor = (c: (typeof calculadas)[number]): number | null =>
      orden.columna === "ingresos" ? c.fila.porcentaje : orden.columna === "conversion" ? c.conversion.valor : orden.columna === "ctr" ? c.ctr.valor : c.ads?.porcentaje ?? null;
    // Sin dato siempre al final, sea cual sea el sentido.
    return [...lista].sort((a, b) => {
      const x = valor(a);
      const y = valor(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return orden.asc ? x - y : y - x;
    });
  }, [calculadas, grupo, orden]);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const pagVisible = visibles.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const pct = (v: number | null) => (v === null ? "—" : `${formatearNumero(Math.round(v * 10) / 10, idioma)} %`);
  const num = (v: number | null) => (v === null ? "—" : formatearNumero(v, idioma));

  function ordenarPor(columna: ColumnaOrden) {
    setOrden((o) => (o.columna === columna ? { columna, asc: !o.asc } : { columna, asc: false }));
    setPagina(1);
  }
  const encabezadoOrden = (columna: ColumnaOrden, texto: string) => ({
    clave: columna,
    numerica: true,
    ariaSort: orden.columna === columna ? (orden.asc ? ("ascending" as const) : ("descending" as const)) : ("none" as const),
    contenido: (
      <button type="button" className={styles.ordenar} onClick={() => ordenarPor(columna)}>
        {texto}
        {orden.columna === columna ? (orden.asc ? " ↑" : " ↓") : ""}
      </button>
    ),
  });

  const semaforoCelda = (s: ReturnType<typeof semaforoPublicacion>, pendiente: boolean) => (
    <span className={styles.celdaSemaforo}>
      <span>{pct(s.valor)}</span>
      {pendiente && s.tono === "neutro" ? null : (
        <Chip estado={s.tono} title={s.tono === "neutro" ? "Menos de la muestra mínima para comparar" : s.deCuenta ? "Comparado con la mediana de la cuenta" : "Comparado con la mediana de su categoría"}>
          {s.tono === "neutro" ? ROTULO_TONO.neutro : s.deCuenta ? `${ROTULO_TONO[s.tono]} · mediana de la cuenta` : ROTULO_TONO[s.tono]}
        </Chip>
      )}
    </span>
  );

  return (
    <>
      <BarraCarga
        estado={cargando ? "cargando" : aviso ? "detenida" : "completa"}
        titulo="Trayendo visitas y categorías…"
        avance={{ hechos: hechas, total: candidatas.length }}
        unidad="publicaciones"
        textoCompleta="Datos completos"
        textoDetenida={aviso ?? undefined}
        ariaLabel="Progreso de visitas y categorías"
        sticky={false}
      />
      {filas.length > candidatas.length ? (
        <p className={styles.nota}>{`Visitas y conversión de las ${candidatas.length} publicaciones con más ingresos (luego, más impresiones); en las demás aparece «—».`}</p>
      ) : null}
      <Tabla
        scroll
        encabezados={[
          "Publicación",
          "Grupo",
          encabezadoOrden("ingresos", "Ingresos · % del total"),
          { clave: "acumulado", contenido: "Acumulado", numerica: true },
          { clave: "ventas", contenido: "Ventas", numerica: true },
          { clave: "visitas", contenido: "Visitas", numerica: true },
          encabezadoOrden("conversion", "Conversión"),
          { clave: "impresiones", contenido: "Impresiones", numerica: true },
          { clave: "clics", contenido: "Clics Ads", numerica: true },
          encabezadoOrden("ctr", "CTR"),
          encabezadoOrden("ads", "% tráfico Ads"),
        ]}
      >
        {pagVisible.map(({ fila, visitas: v, conversion, ctr, ads }) => {
          const pendiente = cargando && candidatas.includes(fila.itemId) && !(fila.itemId in visitas);
          return (
            <FilaTabla key={fila.itemId}>
              <CeldaTabla>
                <div className={styles.publicacion}>
                  {fila.foto ? <img className={styles.foto} src={fila.foto} alt="" width={48} height={48} loading="lazy" /> : <span className={styles.foto} />}
                  <div>
                    <Link className={styles.enlace} href={`/panel/optimizacion/${fila.itemId}?cuenta=${cuentaMlId}`}>
                      {fila.titulo ?? fila.itemId}
                    </Link>
                    <span className={styles.notaNeutra}>
                      {fila.itemId} · {fila.sku ? <SkuCopiable sku={fila.sku} prefijo="SKU " /> : "Sin SKU"}
                    </span>
                  </div>
                </div>
              </CeldaTabla>
              <CeldaTabla>
                <Chip estado={fila.grupo === "killer" ? "exito" : fila.grupo === "potencial" ? "aviso" : "neutro"}>{ROTULO_GRUPO[fila.grupo]}</Chip>
              </CeldaTabla>
              <CeldaTabla numerica>
                {fila.ingresos !== null ? formatearMoneda(fila.ingresos, siteId) : null}
                <span className={styles.notaNeutra}>{fila.grupo === "sin_ventas" ? "—" : pct(fila.porcentaje)}</span>
              </CeldaTabla>
              <CeldaTabla numerica>{pct(fila.acumulado)}</CeldaTabla>
              <CeldaTabla numerica>{num(fila.ventas)}</CeldaTabla>
              <CeldaTabla numerica>{pendiente ? "…" : num(v)}</CeldaTabla>
              <CeldaTabla numerica>{semaforoCelda(conversion, pendiente)}</CeldaTabla>
              <CeldaTabla numerica>{fila.impresiones === null ? "Sin Ads" : num(fila.impresiones)}</CeldaTabla>
              <CeldaTabla numerica>{fila.clics === null ? "Sin Ads" : num(fila.clics)}</CeldaTabla>
              <CeldaTabla numerica>{fila.impresiones === null ? "Sin Ads" : semaforoCelda(ctr, false)}</CeldaTabla>
              <CeldaTabla numerica>
                {fila.clics === null ? (
                  "Sin Ads"
                ) : ads ? (
                  <span className={styles.celdaSemaforo}>
                    <span>{pct(ads.porcentaje)}</span>
                    <Chip estado={ads.tono}>{ads.tono === "exito" ? "Orgánico" : ads.tono === "advertencia" ? "Mixto" : "Depende de Ads"}</Chip>
                    {ads.concilia ? null : <span className={styles.avisoError}>{AVISO_NO_CONCILIA}</span>}
                  </span>
                ) : (
                  <>{pendiente ? "…" : "—"}</>
                )}
              </CeldaTabla>
            </FilaTabla>
          );
        })}
      </Tabla>
      {paginas > 1 ? (
        <nav className={styles.paginas} aria-label="Páginas">
          <button type="button" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>
            ← Anterior
          </button>
          <span className={styles.nota}>{`Página ${paginaActual} de ${paginas}`}</span>
          <button type="button" disabled={paginaActual >= paginas} onClick={() => setPagina(paginaActual + 1)}>
            Siguiente →
          </button>
        </nav>
      ) : null}
    </>
  );
}
