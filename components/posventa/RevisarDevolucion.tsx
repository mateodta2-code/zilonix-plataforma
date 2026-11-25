"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmacionDoble } from "@/components/marco/ConfirmacionDoble";
import { leerMotivosFallaDevolucionAction, revisarDevolucionAction } from "@/app/panel/preguntas/reclamos/[cuentaId]/[reclamoId]/accionesResolucion";

// Reclamos-Dinero (Refs #646) — «Revisar devolución». Aún NO está
// conectado a ninguna pantalla: el detalle de devoluciones (#648) lo
// usará con una línea de import. `motivoNoDisponible` viene del
// servidor (null = la acción está disponible para el vendedor).
type Props = {
  cuentaId: string;
  reclamoId: string;
  devolucionId: string;
  motivoNoDisponible: string | null;
};

const FRASE = "ENTIENDO";

export function RevisarDevolucion({ cuentaId, reclamoId, devolucionId, motivoNoDisponible }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [conFalla, setConFalla] = useState(false);
  const [motivos, setMotivos] = useState<{ id: string; nombre: string }[]>([]);
  const [motivoId, setMotivoId] = useState("");
  const [mensaje, setMensaje] = useState("");

  async function abrirFalla() {
    setConFalla((v) => !v);
    if (motivos.length > 0) return;
    const r = await leerMotivosFallaDevolucionAction({ cuentaId, reclamoId });
    if (r.ok) setMotivos(r.motivos);
    else setAviso({ ok: false, texto: r.aviso });
  }

  async function enviar(resultado: "ok" | "con_falla") {
    const r = await revisarDevolucionAction({ cuentaId, reclamoId, devolucionId, resultado, motivoId: motivoId || undefined, mensaje: mensaje || undefined });
    setAviso({ ok: r.ok, texto: r.aviso });
    router.refresh();
  }

  return (
    <div>
      <ConfirmacionDoble
        textoDisparador="Llegó bien"
        titulo="Confirmar que la devolución llegó bien"
        descripcion="Vas a confirmar que el producto devuelto llegó en buenas condiciones. Mercado Libre le devolverá el dinero al comprador. Esta acción mueve dinero real."
        nombreEsperado={FRASE}
        textoConfirmar="Confirmar que llegó bien"
        deshabilitado={!!motivoNoDisponible}
        onConfirmar={() => enviar("ok")}
      />
      <button type="button" disabled={!!motivoNoDisponible} onClick={abrirFalla}>
        Llegó con problemas
      </button>
      {motivoNoDisponible && <p>{motivoNoDisponible}</p>}
      {conFalla && !motivoNoDisponible && (
        <div>
          <label>
            Motivo
            <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
              <option value="">Elige un motivo</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cuenta qué pasó
            <textarea value={mensaje} maxLength={350} onChange={(e) => setMensaje(e.target.value)} />
          </label>
          <ConfirmacionDoble
            textoDisparador="Reportar problema"
            titulo="Reportar que la devolución llegó con problemas"
            descripcion="Vas a informar a Mercado Libre que el producto devuelto llegó con problemas. Mercado Libre revisará y decidirá sobre el dinero del comprador. Esta acción mueve dinero real."
            nombreEsperado={FRASE}
            textoConfirmar="Reportar problema"
            deshabilitado={!motivoId || !mensaje.trim()}
            onConfirmar={() => enviar("con_falla")}
          />
        </div>
      )}
      {aviso && <p role="status">{aviso.texto}</p>}
    </div>
  );
}
