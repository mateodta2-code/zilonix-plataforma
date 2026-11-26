"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda } from "@/lib/ml/sitios";
import { atribuir, etiquetaCambio, ETIQUETA_POCAS_VENTAS, muestraSuficiente, PUBLICACIONES_POR_TANDA, type Aportes } from "@/lib/optimizacion/atribucion";
import type { CambioPublicacion } from "@/lib/optimizacion/analisisDatos";
import { plataConSigno } from "./AtribucionIngresos";
import { visitasPublicacionesAnalisisAction, type VisitasPublicacion } from "./actions";
import styles from "./analisis.module.css";

type EntradaPeriodo = { dias?: string; periodo?: string; desde?: string; hasta?: string };

// undefined = todavía cargando; null = Mercado Libre no las dio.
type Visitas = Record<string, VisitasPublicacion | undefined>;

type Reparto = { aportes: Aportes; etiqueta: string } | "pocas" | "sin-dato";

function repartoDe(f: CambioPublicacion, v: VisitasPublicacion): Reparto {
  if (v === null) return "sin-dato";
  const ant = { visitas: v.anterior, ventas: f.anterior.ventas, ingresos: f.anterior.ingresos };
  const act = { visitas: v.actual, ventas: f.actual.ventas, ingresos: f.actual.ingresos };
  if (!muestraSuficiente(ant, act)) return "pocas";
  const a = atribuir(ant, act);
  return a ? { aportes: a.aportes, etiqueta: etiquetaCambio(a.aportes, a.cambio, true) } : "sin-dato";
}

export function TablaCambiosPublicacion({
  caidas,
  crecimientos,
  cuentaMlId,
  siteId,
  idioma,
  verMontos,
  periodo,
}: {
  caidas: CambioPublicacion[];
  crecimientos: CambioPublicacion[];
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  verMontos: boolean;
  periodo: EntradaPeriodo;
}) {
  const [visitas, setVisitas] = useState<Visitas>({});
  const [hechos, setHechos] = useState(0);
  const ids = [...caidas, ...crecimientos].map((f) => f.itemId);
  const clave = ids.join(",");
  const periodoClave = JSON.stringify(periodo);

  // Después de pintar: visitas por publicación en tandas de 3 (nunca más
  // en paralelo contra Mercado Libre), con avance «N de M».
  useEffect(() => {
    let cancelado = false;
    const lista = clave ? clave.split(",") : [];
    setVisitas({});
    setHechos(0);
    (async () => {
      for (let i = 0; i < lista.length; i += PUBLICACIONES_POR_TANDA) {
        const tanda = lista.slice(i, i + PUBLICACIONES_POR_TANDA);
        let resultado: Visitas;
        try {
          const r = await visitasPublicacionesAnalisisAction(cuentaMlId, tanda, JSON.parse(periodoClave) as EntradaPeriodo);
          resultado = r.ok ? r.visitas : Object.fromEntries(tanda.map((id) => [id, null]));
        } catch {
          resultado = Object.fromEntries(tanda.map((id) => [id, null]));
        }
        if (cancelado) return;
        setVisitas((previo) => ({ ...previo, ...resultado }));
        setHechos(Math.min(i + tanda.length, lista.length));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [clave, cuentaMlId, periodoClave]);

  const total = ids.length;
  return (
    <div className={styles.listas}>
      {total > 0 ? (
        <BarraCarga
          estado={hechos < total ? "cargando" : "completa"}
          titulo="Trayendo las visitas de cada publicación…"
          avance={{ hechos, total }}
          unidad="publicaciones"
          textoCompleta="Visitas por publicación completas."
          idioma={idioma}
        />
      ) : null}
      <Lista titulo="Mayor caída" vacio="Ninguna publicación bajó sus ingresos." filas={caidas} {...{ visitas, cuentaMlId, siteId, verMontos }} />
      <Lista titulo="Mayor crecimiento" vacio="Ninguna publicación subió sus ingresos." filas={crecimientos} {...{ visitas, cuentaMlId, siteId, verMontos }} />
    </div>
  );
}

function Lista({
  titulo,
  vacio,
  filas,
  visitas,
  cuentaMlId,
  siteId,
  verMontos,
}: {
  titulo: string;
  vacio: string;
  filas: CambioPublicacion[];
  visitas: Visitas;
  cuentaMlId: string;
  siteId: string;
  verMontos: boolean;
}) {
  const plata = (v: string) => formatearMoneda(Number(v), siteId);
  const encabezados = [
    "Publicación",
    ...(verMontos ? ["Ingresos antes → ahora", "Cambio"] : ["Ventas antes → ahora"]),
    "Visitas",
    "Conversión",
    "Ticket",
    "Qué pasó",
  ];
  return (
    <section aria-label={titulo}>
      <p className={styles.seccion}>{titulo}</p>
      {filas.length === 0 ? (
        <p className={styles.nota}>{vacio}</p>
      ) : (
        <Tabla encabezados={encabezados}>
          {filas.map((f) => {
            const v = visitas[f.itemId];
            const r: Reparto | undefined = v === undefined ? undefined : repartoDe(f, v);
            const celda = (factor: keyof Aportes) => {
              if (r === undefined) return <span className={styles.barraMini} role="status" aria-label="Cargando" />;
              if (r === "pocas" || r === "sin-dato") return "—";
              return verMontos ? plataConSigno(r.aportes[factor], siteId) : (Number(r.aportes[factor]) > 0 ? "▲" : Number(r.aportes[factor]) < 0 ? "▼" : "=");
            };
            return (
              <FilaTabla key={f.itemId}>
                <CeldaTabla>
                  <Link className={styles.publicacion} href={`/panel/optimizacion/${f.itemId}?cuenta=${cuentaMlId}`}>
                    {f.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.foto} alt="" width={36} height={36} className={styles.foto} />
                    ) : (
                      <span className={styles.foto} aria-hidden="true" />
                    )}
                    <span>{f.titulo}</span>
                  </Link>
                </CeldaTabla>
                {verMontos ? (
                  <>
                    <CeldaTabla numerica>{`${plata(f.anterior.ingresos)} → ${plata(f.actual.ingresos)}`}</CeldaTabla>
                    <CeldaTabla numerica>{plataConSigno(f.cambio, siteId)}</CeldaTabla>
                  </>
                ) : (
                  <CeldaTabla numerica>{`${f.anterior.ventas} → ${f.actual.ventas}`}</CeldaTabla>
                )}
                <CeldaTabla numerica>{celda("visitas")}</CeldaTabla>
                <CeldaTabla numerica>{celda("conversion")}</CeldaTabla>
                <CeldaTabla numerica>{celda("ticket")}</CeldaTabla>
                <CeldaTabla>
                  {r === undefined ? (
                    <span className={styles.barraMini} role="status" aria-label="Cargando" />
                  ) : r === "pocas" ? (
                    ETIQUETA_POCAS_VENTAS
                  ) : r === "sin-dato" ? (
                    "—"
                  ) : (
                    r.etiqueta
                  )}
                </CeldaTabla>
              </FilaTabla>
            );
          })}
        </Tabla>
      )}
    </section>
  );
}
