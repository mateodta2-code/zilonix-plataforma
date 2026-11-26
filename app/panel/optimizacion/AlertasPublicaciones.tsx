"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { formatearNumero } from "@/lib/ml/sitios";
import { tituloAlerta, type AlertaPublicaciones, type ClaveAlerta } from "@/lib/optimizacion/alertas";
import { alertasPublicacionesAction } from "./actions";
import styles from "./page.module.css";

// Tarjetas de alerta como las de Mercado Libre (Central de vendedores →
// Publicaciones). Se piden DESPUÉS de pintar la lista, para no frenarla.
// Solo lectura: cada tarjeta es un enlace a la lista filtrada.

// `periodo`: parámetros de URL del período elegido (periodo/dias/desde/hasta),
// para que la tarjeta y «Quitar filtro» no lo pierdan.
function href(cuentaMlId: string, clave: ClaveAlerta | null, periodo: Record<string, string>): string {
  const q = new URLSearchParams({ cuenta: cuentaMlId });
  for (const [k, v] of Object.entries(periodo)) q.set(k, v);
  if (clave) q.set("alerta", clave);
  return `/panel/optimizacion?${q.toString()}`;
}

export function AlertasPublicaciones({ cuentaMlId, idioma, activa, periodo = {} }: { cuentaMlId: string; idioma: string; activa: ClaveAlerta | null; periodo?: Record<string, string> }) {
  const [alertas, setAlertas] = useState<AlertaPublicaciones[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [desborda, setDesborda] = useState(false);
  const fila = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vigente = true;
    setAlertas(null);
    setAviso(null);
    alertasPublicacionesAction({ cuentaMlId }).then(
      (r) => {
        if (!vigente) return;
        if (r.ok) setAlertas(r.alertas);
        else setAviso(r.aviso);
      },
      () => vigente && setAviso("No se pudo consultar Mercado Libre. Intenta de nuevo.")
    );
    return () => {
      vigente = false;
    };
  }, [cuentaMlId]);

  const medir = useCallback(() => {
    const el = fila.current;
    setDesborda(Boolean(el) && el!.scrollWidth > el!.clientWidth + 1);
  }, []);
  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir, alertas]);

  function mover(sentido: -1 | 1) {
    const el = fila.current;
    if (el) el.scrollBy({ left: sentido * Math.max(el.clientWidth * 0.8, 200), behavior: "smooth" });
  }

  const cargando = alertas === null && aviso === null;
  return (
    <Tarjeta className={styles.tarjeta}>
      <BarraCarga
        estado={cargando ? "cargando" : aviso ? "detenida" : "inactiva"}
        titulo="Revisando alertas de Mercado Libre…"
        textoDetenida={aviso ?? undefined}
        ariaLabel="Progreso de las alertas de Mercado Libre"
        sticky={false}
      />
      {alertas ? (
        <div className={styles.alertasMarco}>
          {desborda ? (
            <button type="button" className={styles.alertasFlecha} aria-label="Ver alertas anteriores" onClick={() => mover(-1)}>
              ‹
            </button>
          ) : null}
          <div ref={fila} className={styles.alertasFila}>
            {alertas.map((a) => (
              <Link
                key={a.clave}
                scroll={false}
                href={href(cuentaMlId, a.clave, periodo)}
                className={styles.alertaTarjeta}
                aria-current={activa === a.clave ? "page" : undefined}
              >
                <span className={styles.alertaNumero}>{a.cantidad === null ? "—" : formatearNumero(a.cantidad, idioma)}</span>
                <span className={styles.alertaTitulo}>{a.titulo}</span>
                <span className={styles.alertaTexto}>{a.cantidad === null ? "No se pudo leer desde Mercado Libre." : a.texto}</span>
                {a.revisadas ? (
                  <span className={styles.alertaChica}>{`Revisadas ${formatearNumero(a.revisadas.hechas, idioma)} de ${formatearNumero(a.revisadas.total, idioma)}`}</span>
                ) : null}
              </Link>
            ))}
          </div>
          {desborda ? (
            <button type="button" className={styles.alertasFlecha} aria-label="Ver más alertas" onClick={() => mover(1)}>
              ›
            </button>
          ) : null}
        </div>
      ) : null}
      {activa ? (
        <p className={styles.nota}>
          {`Mostrando: ${tituloAlerta(activa)} · `}
          <Link scroll={false} href={href(cuentaMlId, null, periodo)}>
            Quitar filtro
          </Link>
        </p>
      ) : null}
    </Tarjeta>
  );
}

