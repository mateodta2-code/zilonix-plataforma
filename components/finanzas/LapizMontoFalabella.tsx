"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { guardarAjusteOrdenFalabellaAction } from "@/app/panel/finanzas/ventas/actions";
import { Boton } from "@/components/marco/Boton";
import estilos from "./ventasUtilidad.module.css";

// Issue #422 — lápiz en línea de Costo y Envío neto por orden de Falabella.
// Guarda SOLO pedidos_falabella.costo_manual / flete_manual de esa orden
// (nunca la maestra). Vacío = quitar el ajuste. Solo se pinta para quien
// tiene finanzas.modificar; la acción lo vuelve a pedir en el servidor.
export function LapizMontoFalabella({
  pedidoId,
  campo,
  valorActual,
  children,
}: {
  pedidoId: string;
  campo: "costo" | "flete";
  // El ajuste guardado ("1234.00") o null.
  valorActual: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(valorActual ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const titulo = campo === "costo" ? "Costo manual de esta orden" : "Flete manual de esta orden";

  function guardar() {
    setError(null);
    iniciar(async () => {
      try {
        const r = await guardarAjusteOrdenFalabellaAction({ pedidoId, campo, valor });
        if (!r.ok) return setError(r.mensaje);
        setEditando(false);
        router.refresh();
      } catch {
        setError("No se pudo guardar. Inténtalo de nuevo.");
      }
    });
  }

  if (!editando) {
    return (
      <div className={estilos.celdaLapiz}>
        <div>{children}</div>
        <button
          type="button"
          className={estilos.lapiz}
          title={`Editar ${titulo.toLowerCase()}`}
          aria-label={`Editar ${titulo.toLowerCase()}`}
          onClick={() => {
            setValor(valorActual ?? "");
            setEditando(true);
          }}
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <form
      className={estilos.editorLapiz}
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <input
        autoFocus
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={campo === "costo" ? "Vacío = maestra" : "Vacío = sin flete"}
        aria-label={titulo}
        className={`zx-control ${estilos.inputLapiz}`}
        disabled={pendiente}
      />
      <div className={estilos.accionesFiltro}>
        <Boton type="submit" chico disabled={pendiente}>
          {pendiente ? "…" : "Guardar"}
        </Boton>
        <Boton type="button" variante="fantasma" chico disabled={pendiente} onClick={() => setEditando(false)}>
          Cancelar
        </Boton>
      </div>
      {error && <div className={estilos.errorLapiz}>{error}</div>}
    </form>
  );
}
