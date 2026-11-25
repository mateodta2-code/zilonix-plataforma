import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Tarjeta } from "@/components/marco/Tarjeta";
import type { listarMisEntregas } from "@/lib/entregas/entregas";
import { BotonesEntrega } from "./BotonesEntrega";
import styles from "./entregas.module.css";

type Entrega = Awaited<ReturnType<typeof listarMisEntregas>>[number];

const ETIQUETA: Record<string, { texto: string; chip: EstadoChip }> = {
  asignada: { texto: "Asignada", chip: "aviso" },
  en_camino: { texto: "En camino", chip: "advertencia" },
  entregada: { texto: "Entregada", chip: "exito" },
  no_entregada: { texto: "No entregada", chip: "peligro" },
};
const DIA_MS = 24 * 60 * 60 * 1000;

function esAbierta(e: Entrega) {
  return e.estado === "asignada" || e.estado === "en_camino";
}

// Abiertas (de hoy y pendientes de antes) y, aparte, lo cerrado en las
// últimas 24 h. Con la entrega cerrada la base devuelve el contacto en
// null: se muestra «Entrega cerrada», sin enlace para llamar.
export function ListaMisEntregas({ entregas, ahora }: { entregas: Entrega[]; ahora: number }) {
  const abiertas = entregas.filter(esAbierta);
  const cerradas = entregas.filter((e) => !esAbierta(e) && ahora - e.actualizadaTs.getTime() < DIA_MS).reverse();
  if (abiertas.length === 0 && cerradas.length === 0) {
    return (
      <Tarjeta>
        <EstadoVacio>No tienes entregas asignadas por ahora.</EstadoVacio>
      </Tarjeta>
    );
  }
  return (
    <>
      <h2 className={styles.seccion}>Por entregar ({abiertas.length})</h2>
      {abiertas.length === 0 ? (
        <Tarjeta>
          <EstadoVacio>No tienes entregas pendientes.</EstadoVacio>
        </Tarjeta>
      ) : (
        <div className={styles.lista}>{abiertas.map((e) => <TarjetaEntrega key={e.id} entrega={e} />)}</div>
      )}
      {cerradas.length > 0 && (
        <>
          <h2 className={styles.seccion}>Cerradas hoy</h2>
          <div className={styles.lista}>{cerradas.map((e) => <TarjetaEntrega key={e.id} entrega={e} />)}</div>
        </>
      )}
    </>
  );
}

function TarjetaEntrega({ entrega: e }: { entrega: Entrega }) {
  const et = ETIQUETA[e.estado] ?? { texto: e.estado, chip: "neutro" as EstadoChip };
  const abierta = esAbierta(e);
  return (
    <Tarjeta>
      <div className={styles.cabecera}>
        <span className={styles.pedido}>Pedido {e.pedidoReferencia}</span>
        <Chip estado={et.chip}>{et.texto}</Chip>
      </div>
      {e.direccion !== null && e.telefono !== null ? (
        <>
          <p className={styles.direccion}>{e.direccion}</p>
          <p className={styles.dato}>
            {[e.barrio, e.ciudad].filter(Boolean).join(" · ")}
          </p>
          <p className={styles.dato}>
            Recibe: <strong>{e.receptorNombre}</strong>
          </p>
          <a className={styles.llamar} href={`tel:${e.telefono.replace(/[^\d+]/g, "")}`}>
            Llamar {e.telefono}
          </a>
          {e.nota && <p className={styles.dato}>Nota: {e.nota}</p>}
        </>
      ) : (
        <p className={styles.cerrada}>Entrega cerrada.</p>
      )}
      {e.estado === "no_entregada" && e.motivo && <p className={styles.dato}>Motivo: {e.motivo}</p>}
      {abierta && <BotonesEntrega entregaId={e.id} estado={e.estado} />}
    </Tarjeta>
  );
}
