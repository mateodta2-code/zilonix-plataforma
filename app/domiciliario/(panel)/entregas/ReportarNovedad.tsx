"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { DETALLE_MAXIMO, TIPOS_NOVEDAD } from "@/lib/entregas/tiposNovedad";
import { reportarNovedadAction } from "./actions";
import { reducirFoto } from "./reducirFoto";
import styles from "./entregas.module.css";

// Domi-4 — reportar una novedad SIN cerrar la entrega. Tipo obligatorio,
// detalle obligatorio solo en «Otro», foto opcional (reducida en el celular).
export function ReportarNovedad({ entregaId }: { entregaId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);
  const camara = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  function limpiar() {
    setTipo("");
    setDetalle("");
    setFoto(null);
    setVistaPrevia(null);
    setError(null);
  }

  async function alTomarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    const reducida = await reducirFoto(archivo);
    if (!reducida) return setError("No se pudo leer la foto. Tómala otra vez.");
    setError(null);
    setFoto(reducida);
    setVistaPrevia(URL.createObjectURL(reducida));
  }

  async function enviar() {
    const datos = new FormData();
    datos.append("tipo", tipo);
    datos.append("detalle", detalle);
    if (foto) datos.append("foto", foto, "novedad.jpg");
    setEnCurso(true);
    setError(null);
    const r = await reportarNovedadAction(entregaId, datos);
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    limpiar();
    setAbierto(false);
    setEnviada(true);
    router.refresh();
  }

  if (!abierto) {
    return (
      <div className={styles.botones}>
        {enviada && <p className={styles.dato} role="status">Novedad enviada. La entrega sigue abierta.</p>}
        <Boton type="button" className={styles.botonGrande} variante="fantasma" onClick={() => { setEnviada(false); setAbierto(true); }}>
          Reportar novedad
        </Boton>
      </div>
    );
  }

  return (
    <div className={styles.motivo}>
      <label className={styles.etiquetaCampo}>
        ¿Qué pasó?
        <select className={styles.campo} value={tipo} onChange={(e) => setTipo(e.target.value)} required>
          <option value="">Elige una opción</option>
          {Object.entries(TIPOS_NOVEDAD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.etiquetaCampo}>
        {tipo === "otro" ? "Cuéntanos qué pasó" : "Detalle (opcional)"}
        <input className={styles.campo} value={detalle} maxLength={DETALLE_MAXIMO} onChange={(e) => setDetalle(e.target.value)} />
      </label>
      <input ref={camara} type="file" accept="image/*" capture="environment" onChange={alTomarFoto} hidden aria-label="Tomar foto de la novedad" />
      {vistaPrevia && (
        // eslint-disable-next-line @next/next/no-img-element -- blob local, no pasa por next/image
        <img src={vistaPrevia} alt="Foto de la novedad" className={styles.fotoPrevia} />
      )}
      <Boton type="button" className={styles.botonGrande} variante="fantasma" disabled={enCurso} onClick={() => camara.current?.click()}>
        {vistaPrevia ? "Tomar otra foto" : "Agregar foto (opcional)"}
      </Boton>
      <Boton type="button" className={styles.botonGrande} variante="secundario" disabled={enCurso || !tipo || (tipo === "otro" && !detalle.trim())} onClick={enviar}>
        {enCurso ? "Enviando…" : "Enviar novedad"}
      </Boton>
      <Boton type="button" className={styles.botonGrande} variante="fantasma" disabled={enCurso} onClick={() => { limpiar(); setAbierto(false); }}>
        Cancelar
      </Boton>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}
