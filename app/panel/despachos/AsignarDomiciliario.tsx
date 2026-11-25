"use client";

import { TIPOS_NOVEDAD, type TipoNovedad } from "@/lib/entregas/tiposNovedad";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { asignarDomiciliarioAction, quitarDomiciliarioAction } from "./actions";
import styles from "./page.module.css";

type Domiciliario = { miembroId: string; bodegaNombre: string; nombre: string };
type EntregaAsignada = {
  id: string;
  tieneFoto?: boolean;
  estado: string;
  motivo?: string | null;
  miembroDomiciliarioId: string;
  domiciliarioNombre: string;
  receptorNombre: string;
  direccion: string;
  barrio: string | null;
  ciudad: string;
  telefono: string;
  nota: string | null;
};

// Issue #627 (Domi-1) — «Asignar domiciliario» de una entrega local (Flex).
// Solo lo del vendedor, en /panel/despachos: el domiciliario ve sus
// entregas en /domiciliario (Domi-2). Los datos de quien recibe se copian
// al asignar; ninguna llamada a Mercado Libre.
type Novedad = { id: string; tipo: TipoNovedad; detalle: string | null; tieneFoto: boolean; creadaTs: Date };

export function AsignarDomiciliario({ pedidoReferencia, domiciliarios, entrega, novedades = [] }: { pedidoReferencia: string; domiciliarios: Domiciliario[]; entrega: EntregaAsignada | null; novedades?: Novedad[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [miembroId, setMiembroId] = useState(entrega?.miembroDomiciliarioId ?? "");
  const [receptorNombre, setReceptorNombre] = useState(entrega?.receptorNombre ?? "");
  const [direccion, setDireccion] = useState(entrega?.direccion ?? "");
  const [barrio, setBarrio] = useState(entrega?.barrio ?? "");
  const [ciudad, setCiudad] = useState(entrega?.ciudad ?? "");
  const [telefono, setTelefono] = useState(entrega?.telefono ?? "");
  const [nota, setNota] = useState(entrega?.nota ?? "");

  const modificable = !entrega || entrega.estado === "asignada";

  async function guardar() {
    setEnCurso(true);
    setError(null);
    const r = await asignarDomiciliarioAction({ miembroId, pedidoReferencia, receptorNombre, direccion, barrio, ciudad, telefono, nota });
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    setAbierto(false);
    router.refresh();
  }

  async function quitar() {
    setEnCurso(true);
    setError(null);
    const r = await quitarDomiciliarioAction(pedidoReferencia);
    setEnCurso(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <Tarjeta>
      <div className={styles.accionesFiltro}>
        {entrega ? (
          <p className={styles.notaDespachado}>
            Domiciliario: <strong>{entrega.domiciliarioNombre}</strong> — {entrega.estado === "asignada" ? "asignada" : entrega.estado === "en_camino" ? "en camino" : entrega.estado === "entregada" ? "entregada" : "no entregada"}.{entrega.estado === "no_entregada" && entrega.motivo ? ` Motivo: ${entrega.motivo}.` : ""}
            {/* Domi-3: la foto es privada; la ruta comprueba la empresa antes de mostrarla. */}
            {entrega.estado === "entregada" && entrega.tieneFoto && (
              <>
                {" "}
                <a href={`/api/entregas/${entrega.id}/foto`} target="_blank" rel="noopener noreferrer">
                  Ver foto de la entrega
                </a>
              </>
            )}
          </p>
        ) : (
          <p className={styles.notaDespachado}>Entrega local sin domiciliario.</p>
        )}
        {/* Domi-4: novedades del domiciliario (la entrega sigue abierta). */}
        {novedades.length > 0 && (
          <ul className={styles.notaDespachado} aria-label="Novedades del domiciliario">
            {novedades.map((n) => (
              <li key={n.id}>
                <strong>Novedad</strong> {n.creadaTs.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {TIPOS_NOVEDAD[n.tipo]}
                {n.detalle ? `: ${n.detalle}` : ""}
                {n.tieneFoto && (
                  <>
                    {" "}
                    <a href={`/api/entregas/novedades/${n.id}/foto`} target="_blank" rel="noopener noreferrer">
                      Ver foto
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {modificable && (
          <>
            <Boton type="button" onClick={() => setAbierto((v) => !v)} disabled={enCurso || (domiciliarios.length === 0 && !entrega)} title={domiciliarios.length === 0 && !entrega ? "Tu empresa no tiene una bodega ligada con domiciliarios activos" : undefined}>
              {entrega ? "Reasignar" : "Asignar domiciliario"}
            </Boton>
            {entrega && (
              <Boton type="button" variante="peligro" onClick={quitar} disabled={enCurso}>
                Quitar
              </Boton>
            )}
          </>
        )}
      </div>
      {abierto && modificable && (
        <div className={styles.filtros}>
          <Campo etiqueta="Domiciliario">
            <select value={miembroId} onChange={(e) => setMiembroId(e.target.value)} className="zx-control">
              <option value="">Elige uno…</option>
              {domiciliarios.map((d) => (
                <option key={d.miembroId} value={d.miembroId}>
                  {d.nombre} — {d.bodegaNombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Quien recibe">
            <input className="zx-control" value={receptorNombre} onChange={(e) => setReceptorNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Dirección">
            <input className="zx-control" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Barrio">
            <input className="zx-control" value={barrio} onChange={(e) => setBarrio(e.target.value)} />
          </Campo>
          <Campo etiqueta="Ciudad">
            <input className="zx-control" value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </Campo>
          <Campo etiqueta="Teléfono">
            <input className="zx-control" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" />
          </Campo>
          <Campo etiqueta="Nota">
            <input className="zx-control" value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
          <div className={styles.accionesFiltro}>
            <Boton type="button" variante="primario" onClick={guardar} disabled={enCurso || !miembroId}>
              {enCurso ? "Guardando…" : "Guardar"}
            </Boton>
          </div>
        </div>
      )}
      {error && <p className={styles.errorTarjeta}>{error}</p>}
    </Tarjeta>
  );
}
