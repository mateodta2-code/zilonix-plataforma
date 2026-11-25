"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { MOTIVOS_NO_ENTREGA } from "@/lib/entregas/motivos";
import { marcarEntregadoAction, marcarNoEntregadoAction, salirAEntregarAction } from "./actions";
import styles from "./entregas.module.css";

// Botones grandes (≥48 px) para el celular. El motivo de «No entregado»
// es obligatorio aquí y otra vez en el servidor.
export function BotonesEntrega({ entregaId, estado }: { entregaId: string; estado: string }) {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [clave, setClave] = useState("");
  const [detalle, setDetalle] = useState("");

  async function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setEnCurso(true);
    setError(null);
    const r = await fn();
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    setPidiendoMotivo(false);
    router.refresh();
  }

  return (
    <div className={styles.botones}>
      {estado === "asignada" && (
        <Boton type="button" className={styles.botonGrande} disabled={enCurso} onClick={() => correr(() => salirAEntregarAction(entregaId))}>
          Salir a entregar
        </Boton>
      )}
      <Boton type="button" className={styles.botonGrande} variante="secundario" disabled={enCurso} onClick={() => correr(() => marcarEntregadoAction(entregaId))}>
        Entregado
      </Boton>
      {!pidiendoMotivo ? (
        <Boton type="button" className={styles.botonGrande} variante="peligro" disabled={enCurso} onClick={() => setPidiendoMotivo(true)}>
          No entregado
        </Boton>
      ) : (
        <div className={styles.motivo}>
          <label className={styles.etiquetaCampo}>
            Motivo
            <select className={styles.campo} value={clave} onChange={(e) => setClave(e.target.value)} required>
              <option value="">Elige un motivo</option>
              {Object.entries(MOTIVOS_NO_ENTREGA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.etiquetaCampo}>
            {clave === "otro" ? "Cuéntanos qué pasó" : "Detalle (opcional)"}
            <input className={styles.campo} value={detalle} maxLength={200} onChange={(e) => setDetalle(e.target.value)} />
          </label>
          <Boton type="button" className={styles.botonGrande} variante="peligro" disabled={enCurso || !clave || (clave === "otro" && !detalle.trim())} onClick={() => correr(() => marcarNoEntregadoAction(entregaId, clave, detalle))}>
            Confirmar no entregado
          </Boton>
          <Boton type="button" className={styles.botonGrande} variante="fantasma" disabled={enCurso} onClick={() => setPidiendoMotivo(false)}>
            Cancelar
          </Boton>
        </div>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}
