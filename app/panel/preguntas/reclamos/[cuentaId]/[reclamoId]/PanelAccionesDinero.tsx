"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { ConfirmacionDoble } from "@/components/marco/ConfirmacionDoble";
import { formatearMonedaIso, formatearNumero, datosSitioMl } from "@/lib/ml/sitios";
import { ejecutarAccionDineroAction, leerOfertasReembolsoAction } from "./accionesResolucion";
import styles from "./AccionesReclamo.module.css";

type Oferta = { porcentaje: number; monto: number | null };
// Motivo por el que cada acción está deshabilitada (null = disponible).
export type MotivosAcciones = { reembolso_parcial: string | null; reembolso_total: string | null; devolucion: string | null; mediacion: string | null };

type Props = {
  cuentaId: string;
  reclamoId: string;
  siteId: string | null;
  motivos: MotivosAcciones;
  // null = tiene permiso; texto = motivo por el que no.
  sinPermiso: string | null;
  urlMl: string;
};

const FRASE = "ENTIENDO";

export function PanelAccionesDinero({ cuentaId, reclamoId, siteId, motivos, sinPermiso, urlMl }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [panel, setPanel] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [ofertas, setOfertas] = useState<{ moneda: string | null; lista: Oferta[] } | null>(null);
  const [elegida, setElegida] = useState<number | null>(null);
  const idioma = datosSitioMl(siteId).idioma;

  function motivoDe(accion: keyof MotivosAcciones): string | null {
    return sinPermiso ?? motivos[accion];
  }

  async function abrirPanel() {
    setPanel((p) => !p);
    if (ofertas || cargando) return;
    setCargando(true);
    const r = await leerOfertasReembolsoAction({ cuentaId, reclamoId });
    setCargando(false);
    if (r.ok) setOfertas({ moneda: r.ofertas.moneda, lista: r.ofertas.ofertas });
    else setAviso({ ok: false, texto: r.aviso });
  }

  async function ejecutar(accion: "reembolso_parcial" | "reembolso_total" | "devolucion" | "mediacion", porcentaje?: number) {
    const r = await ejecutarAccionDineroAction({ cuentaId, reclamoId, accion, porcentaje });
    setAviso({ ok: r.ok, texto: r.aviso });
    if (r.ok) {
      setPanel(false);
      setElegida(null);
    }
    router.refresh();
  }

  const montoDe = (o: Oferta) => (o.monto != null ? formatearMonedaIso(o.monto, ofertas?.moneda) : null);
  const oferta = ofertas?.lista.find((o) => o.porcentaje === elegida) ?? null;
  const motivoParcial = motivoDe("reembolso_parcial");
  const motivoTotal = motivoDe("reembolso_total");

  function Motivo({ texto }: { texto: string | null }) {
    return texto ? (
      <p className={styles.motivo}>
        {texto}{" "}
        <a href={urlMl} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
          Abrir en Mercado Libre
        </a>
      </p>
    ) : null;
  }

  return (
    <div className={styles.contenedor}>
      <div className={styles.fila}>
        <Boton type="button" variante="secundario" disabled={!!motivoParcial && !!motivoTotal} onClick={abrirPanel} aria-expanded={panel}>
          Elegir monto a reembolsar
        </Boton>
        <ConfirmacionDoble
          textoDisparador="Ofrecer devolución"
          titulo="Ofrecer devolución"
          descripcion="Vas a ofrecerle al comprador devolver el producto. El comprador decide si lo acepta; si lo acepta, el producto vuelve y Mercado Libre le devuelve su dinero. Esta acción mueve dinero real."
          nombreEsperado={FRASE}
          textoConfirmar="Ofrecer devolución"
          deshabilitado={!!motivoDe("devolucion")}
          onConfirmar={() => ejecutar("devolucion")}
        />
        <ConfirmacionDoble
          textoDisparador="Contactar a Mercado Libre"
          titulo="Pedir mediación a Mercado Libre"
          descripcion="Vas a pasar el reclamo a mediación: Mercado Libre decidirá cómo se resuelve y puede devolverle el dinero al comprador. Esta acción mueve dinero real y no se puede deshacer."
          nombreEsperado={FRASE}
          textoConfirmar="Pedir mediación"
          deshabilitado={!!motivoDe("mediacion")}
          onConfirmar={() => ejecutar("mediacion")}
        />
      </div>
      <Motivo texto={motivoDe("devolucion")} />
      <Motivo texto={motivoDe("mediacion") ?? null} />

      {panel && (
        <div className={styles.panel}>
          <p className={styles.titulo}>Monto a reembolsar</p>
          {cargando && <p className={styles.motivo}>Consultando las ofertas de Mercado Libre…</p>}
          {!motivoParcial && ofertas && (
            <div role="radiogroup" aria-label="Porcentaje a reembolsar" className={styles.ofertas}>
              {ofertas.lista.map((o) => (
                <label key={o.porcentaje} className={styles.oferta}>
                  <input type="radio" name="oferta" checked={elegida === o.porcentaje} onChange={() => setElegida(o.porcentaje)} />
                  {formatearNumero(o.porcentaje, idioma)} %{montoDe(o) ? ` — ${montoDe(o)}` : ""}
                </label>
              ))}
            </div>
          )}
          <Motivo texto={motivoParcial} />
          <div className={styles.fila}>
            {oferta && !motivoParcial && (
              <ConfirmacionDoble
                textoDisparador={`Ofrecer reembolso del ${formatearNumero(oferta.porcentaje, idioma)} %`}
                titulo="Ofrecer reembolso parcial"
                descripcion={`Vas a ofrecer un reembolso del ${formatearNumero(oferta.porcentaje, idioma)} %${montoDe(oferta) ? `: ${montoDe(oferta)}` : ""}. El comprador decide si lo acepta; si lo acepta se cierra el reclamo y Mercado Libre le devuelve ese dinero. Esta acción mueve dinero real.`}
                nombreEsperado={FRASE}
                textoConfirmar="Ofrecer reembolso"
                onConfirmar={() => ejecutar("reembolso_parcial", oferta.porcentaje)}
              />
            )}
            {!motivoTotal && (
              <ConfirmacionDoble
                textoDisparador="Reembolsar el total"
                titulo="Reembolsar el total"
                descripcion="Vas a devolverle al comprador el 100 % de lo que pagó y el reclamo se cierra. Esta acción mueve dinero real y no se puede deshacer."
                nombreEsperado={FRASE}
                textoConfirmar="Reembolsar el total"
                onConfirmar={() => ejecutar("reembolso_total")}
              />
            )}
          </div>
          <Motivo texto={motivoTotal && motivoParcial ? motivoTotal : null} />
        </div>
      )}
      <p className={styles.nota}>Para confirmar tendrás que escribir {FRASE}.</p>
      {aviso && (
        <p role="status" className={aviso.ok ? styles.exito : styles.error}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
