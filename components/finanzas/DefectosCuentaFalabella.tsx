"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarDefectosCuentaFalabellaAction } from "@/app/panel/finanzas/ventas/actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import estilos from "./ventasUtilidad.module.css";

export type DefectosCuentaVista = {
  id: string;
  nickname: string;
  comisionPct: string | null;
  flete: string | null;
  ivaVentasPct: string | null;
};

// Issue #422 — respaldo por cuenta para estimar órdenes de una cuenta nueva
// que todavía no tiene reportes de Falabella. Desplegable discreto, solo
// para finanzas.modificar (la acción lo vuelve a pedir en el servidor).
export function DefectosCuentaFalabella({ cuentas }: { cuentas: DefectosCuentaVista[] }) {
  return (
    <details className={estilos.defectosCuenta}>
      <summary>Comisión, flete e IVA de ventas por cuenta</summary>
      <p className={estilos.suave}>
        Solo se usan para estimar órdenes de un SKU sin historial en una cuenta que todavía no tiene ningún reporte de transacciones. Sin %
        de comisión, esas órdenes quedan «Sin reporte de Falabella». El % de IVA de ventas es informativo: muestra «Ventas sin IVA» y no
        cambia la utilidad.
      </p>
      {cuentas.map((c) => (
        <FormularioCuenta key={c.id} cuenta={c} />
      ))}
    </details>
  );
}

function FormularioCuenta({ cuenta }: { cuenta: DefectosCuentaVista }) {
  const router = useRouter();
  const [comision, setComision] = useState(cuenta.comisionPct ?? "");
  const [flete, setFlete] = useState(cuenta.flete ?? "");
  const [iva, setIva] = useState(cuenta.ivaVentasPct ?? "");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <form
      className={estilos.filtros}
      onSubmit={(e) => {
        e.preventDefault();
        setMensaje(null);
        iniciar(async () => {
          try {
            const r = await guardarDefectosCuentaFalabellaAction({ cuentaId: cuenta.id, comisionPct: comision, flete, ivaVentasPct: iva });
            setMensaje(r.ok ? { ok: true, texto: "Guardado." } : { ok: false, texto: r.mensaje });
            if (r.ok) router.refresh();
          } catch {
            setMensaje({ ok: false, texto: "No se pudo guardar. Inténtalo de nuevo." });
          }
        });
      }}
    >
      <Campo etiqueta={`${cuenta.nickname} · % comisión por defecto`}>
        <input inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="Ej. 15,5" className="zx-control" />
      </Campo>
      <Campo etiqueta="Flete por defecto (por unidad)">
        <input inputMode="decimal" value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="Vacío = 0" className="zx-control" />
      </Campo>
      <Campo etiqueta="% IVA de ventas">
        <input inputMode="decimal" value={iva} onChange={(e) => setIva(e.target.value)} placeholder="Vacío = sin configurar" className="zx-control" />
      </Campo>
      <div className={estilos.accionesFiltro}>
        <Boton type="submit" chico disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar"}
        </Boton>
        {mensaje && <span className={mensaje.ok ? estilos.suave : estilos.errorLapiz}>{mensaje.texto}</span>}
      </div>
    </form>
  );
}
