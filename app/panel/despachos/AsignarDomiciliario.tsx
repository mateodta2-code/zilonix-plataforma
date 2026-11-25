"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { asignarDomiciliarioAction, quitarDomiciliarioAction } from "./actions";
import styles from "./page.module.css";

export type DomiciliarioOpcion = { miembroId: string; nombre: string; bodegaNombre: string };

// Issue #627 — botón de cada pedido de entrega local (Flex). Los datos
// del comprador se escriben acá y se copian a la entrega: no se piden a
// Mercado Libre. El domiciliario los ve solo mientras la entrega esté abierta.
export function AsignarDomiciliario({
  pedidoRef,
  domiciliarios,
  actual,
}: {
  pedidoRef: string;
  domiciliarios: DomiciliarioOpcion[];
  actual: { entregaId: string; miembroId: string; nombre: string; estado: "asignada" | "en_camino" } | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const campo = (n: string) => String(f.get(n) ?? "");
    const r = await asignarDomiciliarioAction({
      pedidoRef,
      miembroDomiciliarioId: campo("miembro"),
      datos: { receptorNombre: campo("receptorNombre"), direccion: campo("direccion"), barrio: campo("barrio"), ciudad: campo("ciudad"), telefono: campo("telefono"), nota: campo("nota") },
    });
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    setAbierto(false);
    router.refresh();
  }

  async function quitar() {
    if (!actual) return;
    setEnviando(true);
    setError(null);
    const r = await quitarDomiciliarioAction(actual.entregaId);
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className={styles.asignarDomiciliario}>
      {actual && <p className={styles.asignadoA}>Domiciliario: {actual.nombre} ({actual.estado === "en_camino" ? "en camino" : "asignada"})</p>}
      {!abierto && (
        <div className={styles.asignarAcciones}>
          <Boton variante="secundario" chico type="button" onClick={() => setAbierto(true)} disabled={domiciliarios.length === 0} title={domiciliarios.length === 0 ? "No tienes una bodega con domiciliarios activos" : undefined}>
            {actual ? "Reasignar" : "Asignar domiciliario"}
          </Boton>
          {actual?.estado === "asignada" && (
            <Boton variante="fantasma" chico type="button" onClick={quitar} disabled={enviando}>
              Quitar
            </Boton>
          )}
        </div>
      )}
      {abierto && (
        <form onSubmit={enviar} className={styles.asignarForm}>
          <Campo etiqueta="Domiciliario">
            <select name="miembro" className="zx-control" required defaultValue={actual?.miembroId ?? ""}>
              <option value="" disabled>Elige uno</option>
              {domiciliarios.map((d) => (
                <option key={d.miembroId} value={d.miembroId}>{d.nombre} · {d.bodegaNombre}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Nombre de quien recibe"><input name="receptorNombre" className="zx-control" required maxLength={300} /></Campo>
          <Campo etiqueta="Dirección"><input name="direccion" className="zx-control" required maxLength={300} /></Campo>
          <Campo etiqueta="Barrio"><input name="barrio" className="zx-control" maxLength={300} /></Campo>
          <Campo etiqueta="Ciudad"><input name="ciudad" className="zx-control" required maxLength={300} /></Campo>
          <Campo etiqueta="Teléfono"><input name="telefono" className="zx-control" required maxLength={300} inputMode="tel" /></Campo>
          <Campo etiqueta="Nota"><input name="nota" className="zx-control" maxLength={300} /></Campo>
          {error && <p role="alert" className={styles.asignarError}>{error}</p>}
          <div className={styles.asignarAcciones}>
            <Boton type="submit" chico disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</Boton>
            <Boton variante="fantasma" chico type="button" onClick={() => setAbierto(false)}>Cancelar</Boton>
          </div>
        </form>
      )}
      {!abierto && error && <p role="alert" className={styles.asignarError}>{error}</p>}
    </div>
  );
}
