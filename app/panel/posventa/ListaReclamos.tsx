import Link from "next/link";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Tarjeta } from "@/components/marco/Tarjeta";
import type { ReclamoAbierto } from "@/lib/ml/preguntas";
import { compararPlazo, minutosDesde, minutosHasta, rotuloEtapaReclamo, rotuloTipoReclamo, textoEspera, textoPlazo, tonoPlazo } from "@/lib/preguntas/tiempo";
import styles from "./Posventa.module.css";

// Posventa-0 (Refs #647) — la lista de reclamos que Reclamos-A dejó en
// Preguntas, ahora con buscador y orden. Cada fila abre el detalle de
// Reclamos-A. El texto de ML se muestra como texto plano.

export type OrdenReclamos = "plazo" | "fecha" | "etapa";
export const ORDENES_RECLAMOS: { valor: OrdenReclamos; etiqueta: string }[] = [
  { valor: "plazo", etiqueta: "Plazo más cercano" },
  { valor: "fecha", etiqueta: "Más recientes" },
  { valor: "etapa", etiqueta: "Etapa" },
];

export function leerOrdenReclamos(valor: string | string[] | undefined): OrdenReclamos {
  return valor === "fecha" || valor === "etapa" ? valor : "plazo";
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Pura. Busca por #venta o por texto del motivo (el título del producto
// no viene en el listado de ML y no se hacen llamadas extra por fila).
export function filtrarYOrdenarReclamos(
  reclamos: ReclamoAbierto[],
  opciones: { cuentaId: string | null; busqueda: string; orden: OrdenReclamos }
): ReclamoAbierto[] {
  const q = normalizar(opciones.busqueda.trim().replace(/^#/, ""));
  const filtrados = reclamos.filter((r) => {
    if (opciones.cuentaId && r.cuentaMlId !== opciones.cuentaId) return false;
    if (!q) return true;
    return normalizar(`${r.recursoId ?? ""} ${r.motivoTexto ?? ""} ${r.motivo ?? ""} ${r.nickname}`).includes(q);
  });
  const fechaMs = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
  return [...filtrados].sort((a, b) => {
    if (opciones.orden === "fecha") return fechaMs(b.fecha) - fechaMs(a.fecha);
    if (opciones.orden === "etapa") {
      return (rotuloEtapaReclamo(a.etapa) ?? "").localeCompare(rotuloEtapaReclamo(b.etapa) ?? "") || compararPlazo(a.plazo, b.plazo);
    }
    return compararPlazo(a.plazo, b.plazo) || fechaMs(a.fecha) - fechaMs(b.fecha);
  });
}

export function ListaReclamos({ reclamos, ahoraMs }: { reclamos: ReclamoAbierto[]; ahoraMs: number }) {
  const ahora = new Date(ahoraMs);
  if (reclamos.length === 0) return <EstadoVacio>No hay reclamos abiertos con estos filtros.</EstadoVacio>;
  return (
    <Tarjeta>
      <ul className={styles.lista}>
        {reclamos.map((reclamo) => {
          const minutos = minutosHasta(reclamo.plazo, ahora);
          return (
            <li key={`${reclamo.cuentaMlId}-${reclamo.id}`} className={styles.fila}>
              <div className={styles.filaEnlace}>
                <div className={styles.cabecera}>
                  <span className={styles.cuenta}>{reclamo.nickname}</span>
                  <Chip estado="neutro">{rotuloTipoReclamo(reclamo.tipo)}</Chip>
                  <Chip estado="aviso">{rotuloEtapaReclamo(reclamo.etapa)}</Chip>
                  <Chip estado={tonoPlazo(minutos)}>{textoPlazo(minutos)}</Chip>
                </div>
                <p className={styles.texto}>{reclamo.motivoTexto ?? reclamo.motivo ?? "Motivo sin detalle"}</p>
                <p className={styles.texto}>
                  Venta {reclamo.recursoId ?? "—"} · abierto {textoEspera(minutosDesde(reclamo.fecha, ahora))} · último cambio {textoEspera(minutosDesde(reclamo.actualizado, ahora))}
                </p>
                {/* El enlace del botón se estira sobre toda la tarjeta (::after): clicable completa sin anidar <a>. */}
                <Link href={`/panel/posventa/reclamos/${reclamo.cuentaMlId}/${reclamo.id}`} className={styles.ver}>
                  Ver reclamo
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}
