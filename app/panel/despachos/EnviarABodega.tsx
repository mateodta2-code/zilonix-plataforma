"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { enviarABodegaAction } from "./actions";
import styles from "./page.module.css";

// Issue #628 (Bodega-3) — «Enviar a la bodega» y «Preparado por la bodega».
// A la bodega solo viaja número de pedido, tipo de envío, SKU y cantidad.
export function EnviarABodega({ pedidoIdExterno, puedeModificar, estado, bodegaNombre }: { pedidoIdExterno: string; puedeModificar: boolean; estado: "pendiente" | "preparado" | null; bodegaNombre: string | null }) {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setEnCurso(true);
    setError(null);
    const r = await enviarABodegaAction(pedidoIdExterno);
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (!estado && !puedeModificar) return null;
  return (
    <Tarjeta>
      <div className={styles.accionesFiltro}>
        {estado === "preparado" ? (
          <p className={styles.notaDespachado}>
            <strong>Preparado por la bodega</strong>
            {bodegaNombre ? ` (${bodegaNombre})` : ""}.
          </p>
        ) : estado === "pendiente" ? (
          <p className={styles.notaDespachado}>Enviado a la bodega{bodegaNombre ? ` (${bodegaNombre})` : ""}; falta que lo prepare.</p>
        ) : (
          <Boton type="button" onClick={enviar} disabled={enCurso}>
            {enCurso ? "Enviando…" : "Enviar a la bodega"}
          </Boton>
        )}
      </div>
      {error && <p className={styles.errorTarjeta}>{error}</p>}
    </Tarjeta>
  );
}
