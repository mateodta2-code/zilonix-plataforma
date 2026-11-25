"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { LIMITES_SOPORTE, MODULOS_SOPORTE } from "@/lib/soporte/validacion";
import { abrirTicketAction } from "./actions";
import styles from "./page.module.css";

// React 18.3.1: sin useFormState — la acción se llama directo y su
// error se muestra acá.
export function FormTicket() {
  const router = useRouter();
  const [asunto, setAsunto] = useState("");
  const [modulo, setModulo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const resultado = await abrirTicketAction(asunto, mensaje, modulo);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setAsunto("");
    setMensaje("");
    setModulo("");
    if (resultado.ticketId) router.push(`/panel/tickets/${resultado.ticketId}`);
  }

  return (
    <form onSubmit={enviar} className={styles.formulario}>
      <Campo etiqueta="Asunto">
        <input
          className="zx-control"
          value={asunto}
          onChange={(e) => setAsunto(e.target.value)}
          maxLength={LIMITES_SOPORTE.asuntoMax}
          required
          placeholder="ej. No se sincronizan mis pedidos"
        />
      </Campo>
      <Campo etiqueta="Módulo">
        <select className="zx-control" value={modulo} onChange={(e) => setModulo(e.target.value)} required>
          <option value="">Elige un módulo</option>
          {MODULOS_SOPORTE.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Cuéntanos qué pasa">
        <textarea
          className="zx-control"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          maxLength={LIMITES_SOPORTE.mensajeMax}
          rows={5}
          required
          placeholder="Explica qué intentabas hacer y qué ocurrió."
        />
      </Campo>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" disabled={enviando}>
          {enviando ? "Enviando…" : "Abrir ticket"}
        </Boton>
        <span className={styles.contador}>
          {mensaje.length}/{LIMITES_SOPORTE.mensajeMax}
        </span>
      </div>
    </form>
  );
}
