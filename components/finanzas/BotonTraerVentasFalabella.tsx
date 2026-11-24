"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { traerVentasFalabellaAction } from "@/app/panel/finanzas/ventas/actions";
import { Boton } from "@/components/marco/Boton";
import { Toast, type ItemToast } from "@/components/marco/Toast";
import estilos from "./ventasUtilidad.module.css";

// Issue #422 — trae de Falabella las órdenes del mes en curso de todas
// las cuentas conectadas y recarga la tabla (router.refresh). El
// resultado va en un Toast (components/marco/Toast.tsx), que se cierra
// solo. Puede tardar: cada orden pide sus ítems a Falabella.
export function BotonTraerVentasFalabella() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [toasts, setToasts] = useState<ItemToast[]>([]);

  function mostrarToast(texto: string, estado: ItemToast["estado"]) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((actual) => [...actual, { id, texto, estado }]);
    setTimeout(() => setToasts((actual) => actual.filter((t) => t.id !== id)), 8000);
  }

  function traer() {
    iniciar(async () => {
      try {
        const r = await traerVentasFalabellaAction();
        mostrarToast(r.mensaje, r.ok ? "exito" : r.importados > 0 ? "aviso" : "peligro");
      } catch {
        mostrarToast("No se pudieron traer las ventas de Falabella. Inténtalo de nuevo en unos minutos.", "peligro");
      }
      router.refresh();
    });
  }

  return (
    <div className={estilos.traerVentas}>
      <div className={estilos.accionesFiltro}>
        <Boton type="button" variante="primario" onClick={traer} disabled={pendiente}>
          {pendiente ? "Trayendo ventas…" : "Traer ventas de Falabella"}
        </Boton>
        <span className={estilos.suave}>
          {pendiente ? "Puede tardar unos minutos; no cierres la página." : "Lee de Falabella las órdenes del mes en curso de todas las cuentas conectadas."}
        </span>
      </div>
      <Toast items={toasts} onCerrar={(id) => setToasts((actual) => actual.filter((t) => t.id !== id))} />
    </div>
  );
}
