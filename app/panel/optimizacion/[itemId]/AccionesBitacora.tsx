"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { LARGO_NOTA, RESULTADOS_REVISION } from "@/lib/optimizacion/bitacoraResultado";
import { guardarNotaBitacoraAction, revisarCambioAction } from "../actions";
import styles from "../page.module.css";

// Anotar a mano un cambio hecho fuera de Zilonix (directo en Mercado
// Libre, publicidad…). A los 7 días la bitácora muestra su resultado.
export function NotaBitacora({ cuentaMlId, itemId, hoy }: { cuentaMlId: string; itemId: string; hoy: string }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [fecha, setFecha] = useState(hoy);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await guardarNotaBitacoraAction({ cuentaMlId, itemId, fecha, texto });
      setAviso({ ok: r.ok, texto: r.aviso });
      if (r.ok) {
        setTexto("");
        setAbierta(false);
        router.refresh();
      }
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar la nota. Intenta de nuevo." });
    }
    setGuardando(false);
  }

  return (
    <div className={styles.notaBitacora}>
      {abierta ? (
        <>
          <Campo etiqueta="¿Cuándo hiciste el cambio?">
            <input type="date" className="zx-control" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} disabled={guardando} />
          </Campo>
          <Campo etiqueta="¿Qué cambiaste? (fuera de Zilonix: directo en Mercado Libre, publicidad, stock…)">
            <textarea className="zx-control" rows={2} maxLength={LARGO_NOTA} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: subí el presupuesto diario de la campaña" disabled={guardando} />
          </Campo>
          <span className={styles.accionesBitacora}>
            <Boton type="button" chico onClick={guardar} disabled={guardando || !texto.trim()}>
              {guardando ? "Guardando…" : "Guardar nota"}
            </Boton>
            <Boton type="button" chico variante="fantasma" onClick={() => setAbierta(false)} disabled={guardando}>
              Cancelar
            </Boton>
          </span>
        </>
      ) : (
        <Boton type="button" chico variante="secundario" onClick={() => setAbierta(true)}>
          Anotar un cambio
        </Boton>
      )}
      {aviso ? (
        <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
          {aviso.texto}
        </p>
      ) : null}
    </div>
  );
}

// «Revisado»: el resultado del cambio y un comentario. Se puede cambiar.
// Sin resultado se guarda solo el comentario; el cambio sigue sin revisar.
export function RevisarCambio({
  cuentaMlId,
  itemId,
  refCambio,
  actual,
}: {
  cuentaMlId: string;
  itemId: string;
  refCambio: string;
  actual: { resultado: string | null; comentario: string | null } | null;
}) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [resultado, setResultado] = useState(actual?.resultado ?? "");
  const [comentario, setComentario] = useState(actual?.comentario ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await revisarCambioAction({ cuentaMlId, itemId, ref: refCambio, resultado, comentario });
      if (r.ok) {
        setAbierta(false);
        router.refresh();
      } else {
        setError(r.aviso);
      }
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    }
    setGuardando(false);
  }

  if (!abierta) {
    return (
      <Boton type="button" chico variante={actual?.resultado ? "fantasma" : "secundario"} onClick={() => setAbierta(true)}>
        {actual?.resultado ? "Cambiar revisión" : "Revisar"}
      </Boton>
    );
  }
  return (
    <div className={styles.revisarCambio}>
      <span className={styles.accionesBitacora} role="radiogroup" aria-label="Resultado del cambio">
        {RESULTADOS_REVISION.map((r) => (
          <Boton key={r.id} type="button" chico variante={resultado === r.id ? "primario" : "secundario"} onClick={() => setResultado(r.id)} aria-pressed={resultado === r.id} disabled={guardando}>
            {r.rotulo}
          </Boton>
        ))}
      </span>
      <input className="zx-control" maxLength={LARGO_NOTA} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario (opcional)" aria-label="Comentario de la revisión" disabled={guardando} />
      <span className={styles.accionesBitacora}>
        <Boton type="button" chico onClick={guardar} disabled={guardando || (!resultado && !comentario.trim())}>
          {guardando ? "Guardando…" : resultado ? "Guardar revisión" : "Guardar comentario"}
        </Boton>
        <Boton type="button" chico variante="fantasma" onClick={() => setAbierta(false)} disabled={guardando}>
          Cancelar
        </Boton>
      </span>
      {!resultado ? <p className={styles.notaNeutra}>Elige Sirvió, No sirvió o Sin cambio para dar el cambio por revisado. Sin resultado se guarda solo el comentario.</p> : null}
      {error ? <p className={styles.avisoError}>{error}</p> : null}
    </div>
  );
}
