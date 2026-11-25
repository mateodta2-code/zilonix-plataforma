import Link from "next/link";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ROTULOS_ESTADO_DEVOLUCION, type EstadoSimpleDevolucion, type FilaDevolucion, type ProductoVentaFila } from "@/lib/ml/devoluciones";
import { datosSitioMl, formatearMonedaIso, formatearNumero } from "@/lib/ml/sitios";
import styles from "./Devoluciones.module.css";

// Posventa-Devoluciones (Refs #648) — lista solo lectura. El texto de ML
// se muestra como texto plano.

export const TAMANO_PAGINA_LISTA = 10;
export const ESTADOS_FILTRO: EstadoSimpleDevolucion[] = ["en_camino", "llego", "revisada", "cerrada", "en_proceso"];

const TONO: Record<EstadoSimpleDevolucion, EstadoChip> = { en_camino: "aviso", llego: "advertencia", revisada: "exito", cerrada: "neutro", en_proceso: "neutro" };

export function leerEstadoFiltro(valor: string | string[] | undefined): EstadoSimpleDevolucion | null {
  return typeof valor === "string" && (ESTADOS_FILTRO as string[]).includes(valor) ? (valor as EstadoSimpleDevolucion) : null;
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Pura. Busca por # de venta, cuenta o código de motivo.
export function filtrarDevoluciones(filas: FilaDevolucion[], o: { busqueda: string; estado: EstadoSimpleDevolucion | null }): FilaDevolucion[] {
  const q = normalizar(o.busqueda.trim().replace(/^#/, ""));
  return filas.filter((f) => {
    if (o.estado && f.estado !== o.estado) return false;
    if (!q) return true;
    return normalizar(`${f.reclamo.recursoId ?? ""} ${f.reclamo.motivoId ?? ""} ${f.nickname}`).includes(q);
  });
}

export function contarPorEstado(filas: FilaDevolucion[]): Record<EstadoSimpleDevolucion, number> {
  const c: Record<EstadoSimpleDevolucion, number> = { en_camino: 0, llego: 0, revisada: 0, cerrada: 0, en_proceso: 0 };
  for (const f of filas) c[f.estado] += 1;
  return c;
}

export function ListaDevoluciones({ filas, productos }: { filas: FilaDevolucion[]; productos: Record<string, ProductoVentaFila | null> }) {
  if (filas.length === 0) return <EstadoVacio>No hay devoluciones con estos filtros.</EstadoVacio>;
  return (
    <Tarjeta>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {filas.map((f) => {
          const clave = `${f.cuentaMlId}-${f.reclamo.id}`;
          const p = productos[clave] ?? null;
          const sitio = datosSitioMl(f.siteId);
          return (
            <li key={clave} className={styles.fila}>
              <div className={styles.producto}>
                {p?.foto ? <FotoConZoom src={p.foto} alt={p.titulo ?? "Producto"} claseMiniatura={styles.foto} /> : null}
                <div>
                  <p className={styles.titulo}>{p?.titulo ?? "Producto sin detalle"}</p>
                  <p className={styles.texto}>
                    Venta #{f.reclamo.recursoId ?? "—"} · {f.nickname}
                  </p>
                  {p && p.precioUnitario !== null && (
                    <p className={styles.texto}>
                      {formatearMonedaIso(p.precioUnitario, p.moneda ?? sitio.moneda)}
                      {p.cantidad !== null && ` x ${formatearNumero(p.cantidad, sitio.idioma)} ${p.cantidad === 1 ? "unidad" : "unidades"}`}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.estadoCaja}>
                <Chip estado={TONO[f.estado]}>{ROTULOS_ESTADO_DEVOLUCION[f.estado]}</Chip>
                <Link href={`/panel/posventa/devoluciones/${f.cuentaMlId}/${f.reclamo.id}`} className={styles.enlace}>
                  Ver devolución →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}
