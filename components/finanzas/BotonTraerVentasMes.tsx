"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { traerVentasDelMesAction, type EstadoTraerVentas } from "@/app/panel/finanzas/ventas/actions";
import { Boton } from "@/components/marco/Boton";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 — trae de Mercado Libre las ventas del mes en curso de la
// cuenta elegida en el filtro (o de todas) y recarga el detalle. Puede
// tardar: cada venta pide su envío y sus publicaciones a ML.
export function BotonTraerVentasMes({ cuentaId }: { cuentaId: string | null }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [estado, setEstado] = useState<EstadoTraerVentas | null>(null);

  function traer() {
    setEstado(null);
    iniciar(async () => {
      try {
        setEstado(await traerVentasDelMesAction(cuentaId));
      } catch {
        setEstado({ ok: false, lineas: ["No se pudieron traer las ventas. Inténtalo de nuevo en unos minutos."] });
      }
      router.refresh();
    });
  }

  return (
    <div className={estilos.traerVentas}>
      <div className={estilos.accionesFiltro}>
        <Boton type="button" variante="secundario" chico onClick={traer} disabled={pendiente}>
          {pendiente ? "Trayendo ventas…" : "Traer ventas de este mes"}
        </Boton>
        <span className={estilos.suave}>
          {pendiente
            ? "Puede tardar unos minutos; no cierres la página."
            : `Lee de Mercado Libre las ventas del mes en curso de ${cuentaId ? "la cuenta elegida" : "todas las cuentas conectadas"}.`}
        </span>
      </div>
      {estado && (
        <div className={estado.ok ? estilos.avisoExito : estilos.avisoError} role="status">
          <ul className={estilos.listaSimple}>
            {estado.lineas.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
