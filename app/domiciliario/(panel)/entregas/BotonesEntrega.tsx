"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { MOTIVOS_NO_ENTREGA } from "@/lib/entregas/motivos";
import { reducirFoto } from "./reducirFoto";
import { marcarEntregadoAction, marcarNoEntregadoAction, salirAEntregarAction } from "./actions";
import styles from "./entregas.module.css";

// Botones grandes (≥48 px) para el celular. El motivo de «No entregado»
// es obligatorio aquí y otra vez en el servidor. «Entregado» exige foto
// (Domi-3), también en el servidor y en la base.
export function BotonesEntrega({ entregaId, estado }: { entregaId: string; estado: string }) {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [clave, setClave] = useState("");
  const [detalle, setDetalle] = useState("");
  const camara = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

  // La vista previa vive solo en memoria del navegador; se libera al cambiarla.
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  async function alTomarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setError(null);
    const reducida = await reducirFoto(archivo);
    if (!reducida) return setError("No se pudo leer la foto. Tómala otra vez.");
    setFoto(reducida);
    setVistaPrevia(URL.createObjectURL(reducida));
  }

  function confirmarEntregado() {
    if (!foto) return;
    const datos = new FormData();
    datos.append("foto", foto, "entrega.jpg");
    return correr(() => marcarEntregadoAction(entregaId, datos));
  }

  async function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setEnCurso(true);
    setError(null);
    const r = await fn();
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    setPidiendoMotivo(false);
    setFoto(null);
    setVistaPrevia(null);
    router.refresh();
  }

  return (
    <div className={styles.botones}>
      {estado === "asignada" && (
        <Boton type="button" className={styles.botonGrande} disabled={enCurso} onClick={() => correr(() => salirAEntregarAction(entregaId))}>
          Salir a entregar
        </Boton>
      )}
      {/* capture="environment": abre directo la cámara trasera en el celular. */}
      <input ref={camara} type="file" accept="image/*" capture="environment" onChange={alTomarFoto} hidden aria-label="Tomar foto de la entrega" />
      {!vistaPrevia ? (
        <Boton type="button" className={styles.botonGrande} variante="secundario" disabled={enCurso} onClick={() => camara.current?.click()}>
          Entregado (tomar foto)
        </Boton>
      ) : (
        <div className={styles.motivo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob local, no pasa por next/image */}
          <img src={vistaPrevia} alt="Foto de la entrega" className={styles.fotoPrevia} />
          <Boton type="button" className={styles.botonGrande} variante="secundario" disabled={enCurso} onClick={confirmarEntregado}>
            {enCurso ? "Guardando…" : "Confirmar entregado"}
          </Boton>
          <Boton type="button" className={styles.botonGrande} variante="fantasma" disabled={enCurso} onClick={() => camara.current?.click()}>
            Tomar otra foto
          </Boton>
          <Boton type="button" className={styles.botonGrande} variante="fantasma" disabled={enCurso} onClick={() => { setFoto(null); setVistaPrevia(null); }}>
            Cancelar
          </Boton>
        </div>
      )}
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
