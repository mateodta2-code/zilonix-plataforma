import Link from "next/link";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";
import { formatearMonedaIso, formatearNumero, datosSitioMl } from "@/lib/ml/sitios";
import { paginar, type EstadoFiltro, type FilaVenta, type Filtros } from "./filtros";
import styles from "./Mensajes.module.css";

const ROTULOS: Record<EstadoFiltro, string> = { sin_leer: "Sin leer", por_responder: "Por responder", respondido: "Leídos / Respondidos" };
const TEXTO_ESTADO: Record<FilaVenta["estadoMensaje"], string> = {
  sin_leer: "Mensaje nuevo del comprador",
  por_responder: "El comprador escribió: falta responder",
  respondido: "Mensaje respondido",
  sin_mensajes: "Sin mensajes",
};

function enlace(f: Filtros, cambios: Partial<{ estado: string | null; q: string | null; desde: string | null; pagina: number | null }>): string {
  const base = { estado: f.estado, q: f.q || null, desde: f.desde, pagina: f.pagina > 1 ? f.pagina : null, ...cambios };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return `/panel/posventa/mensajes${s ? `?${s}` : ""}`;
}

// Lista tipo «Mensajes» de la Central de vendedores. Todo el contenido
// viene de ML en vivo; nada del comprador se guarda.
export function ListaMensajes({ todas, filtradas, conteos, filtros }: { todas: FilaVenta[]; filtradas: FilaVenta[]; conteos: Record<EstadoFiltro, number>; filtros: Filtros }) {
  const pag = paginar(filtradas, filtros.pagina);
  return (
    <>
      <div className={styles.tarjetasEstado}>
        {(Object.keys(ROTULOS) as EstadoFiltro[]).map((e) => (
          <Link key={e} href={enlace(filtros, { estado: filtros.estado === e ? null : e, pagina: null })} className={`${styles.estadoTarjeta} ${filtros.estado === e ? styles.estadoActiva : ""}`} aria-current={filtros.estado === e}>
            <span className={styles.estadoNumero}>{conteos[e]}</span>
            <span className={styles.estadoRotulo}>{ROTULOS[e]}</span>
          </Link>
        ))}
      </div>

      <form method="get" action="/panel/posventa/mensajes" className={styles.herramientas}>
        {filtros.estado && <input type="hidden" name="estado" value={filtros.estado} />}
        <label>
          Buscar
          <input type="search" name="q" defaultValue={filtros.q} placeholder="N.º de venta o producto" />
        </label>
        <label>
          Filtrar por fecha (desde)
          <input type="date" name="desde" defaultValue={filtros.desde ?? ""} />
        </label>
        <Boton type="submit" variante="secundario">
          Aplicar
        </Boton>
      </form>

      <div className={styles.chips}>
        <span className={styles.contador}>
          {filtradas.length} {filtradas.length === 1 ? "venta" : "ventas"}
        </span>
        {filtros.estado && (
          <Link href={enlace(filtros, { estado: null, pagina: null })}>
            <Chip estado="aviso">{ROTULOS[filtros.estado]} ✕</Chip>
          </Link>
        )}
        {filtros.q && (
          <Link href={enlace(filtros, { q: null, pagina: null })}>
            <Chip estado="aviso">«{filtros.q}» ✕</Chip>
          </Link>
        )}
        {filtros.desde && (
          <Link href={enlace(filtros, { desde: null, pagina: null })}>
            <Chip estado="aviso">Desde {filtros.desde} ✕</Chip>
          </Link>
        )}
      </div>

      {todas.length === 0 && <div className={styles.aviso}>No hay ventas de los últimos 30 días para revisar.</div>}
      <ul className={styles.lista}>
        {pag.filas.map((v) => {
          const sitio = datosSitioMl(v.siteId);
          return (
            <li key={`${v.cuentaId}-${v.ordenId}`}>
              <div className={styles.fila}>
                <div className={styles.producto}>
                  {v.foto && <FotoConZoom src={v.foto} alt={v.titulo} claseMiniatura={styles.foto} />}
                  <div>
                    <p className={styles.detalle}>
                      Venta #{v.ordenId} · {v.cuentaNick} · {formatearFechaPedido(new Date(v.fecha), v.moneda)}
                    </p>
                    <p className={styles.titulo}>{v.titulo}</p>
                    {v.precio !== null && (
                      <p className={styles.detalle}>
                        {formatearMonedaIso(v.precio, v.moneda)}
                        {v.cantidad !== null && ` x ${formatearNumero(v.cantidad, sitio.idioma)} ${v.cantidad === 1 ? "unidad" : "unidades"}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.caja}>
                  <strong>{v.estadoVenta}</strong>
                  <span>{TEXTO_ESTADO[v.estadoMensaje]}</span>
                  <BotonLink variante="secundario" chico href={`/panel/posventa/mensajes/${v.cuentaId}/${v.ordenId}`}>
                    Revisar mensaje
                  </BotonLink>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pag.paginas > 1 && (
        <nav className={styles.paginacion} aria-label="Paginación">
          {pag.pagina > 1 && <Link href={enlace(filtros, { pagina: pag.pagina - 1 })}>‹ Anterior</Link>}
          <span className={styles.contador}>
            Página {pag.pagina} de {pag.paginas}
          </span>
          {pag.pagina < pag.paginas && <Link href={enlace(filtros, { pagina: pag.pagina + 1 })}>Siguiente ›</Link>}
        </nav>
      )}
    </>
  );
}
