import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { listarKardex, listarSkusConStock } from "@/lib/inventario/stock";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import styles from "../inventario.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ETIQUETA_TIPO: Record<string, { texto: string; estado: EstadoChip }> = {
  entrada: { texto: "Entrada", estado: "exito" },
  salida: { texto: "Salida", estado: "peligro" },
  ajuste: { texto: "Ajuste", estado: "aviso" },
  traslado: { texto: "Traslado", estado: "neutro" },
  reserva: { texto: "Reserva", estado: "aviso" },
  liberacion: { texto: "Liberación", estado: "neutro" },
  confirmacion: { texto: "Confirmación", estado: "peligro" },
};
const ETIQUETA_ORIGEN: Record<string, string> = { manual: "Manual", recepcion: "Recepción", pedido_ml: "Pedido ML", traslado: "Traslado", devolucion: "Devolución" };

function conSigno(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// Issue #280 — kardex de solo lectura (append-only: nada acá se edita
// ni se borra). Pide inventario.consultar.
export default async function KardexPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  // Un id mal formado en la URL se ignora (no se le pasa a la base).
  const sku = normalizarParametro(searchParams.sku);
  const bodega = normalizarParametro(searchParams.bodega);
  const skuId = sku && UUID_RE.test(sku) ? sku : undefined;
  const bodegaId = bodega && UUID_RE.test(bodega) ? bodega : undefined;
  const pagina = parsearPagina(normalizarParametro(searchParams.pagina));

  const [resultado, lista, skusSimples] = await Promise.all([
    listarKardex(activa.id, { skuId, bodegaId, pagina }),
    listarBodegas(activa.id),
    listarSkusConStock(activa.id),
  ]);
  const hrefPagina = (p: number) =>
    `/panel/inventario/kardex?${new URLSearchParams({ ...(skuId ? { sku: skuId } : {}), ...(bodegaId ? { bodega: bodegaId } : {}), pagina: String(p) })}`;

  const filtrosExportar = new URLSearchParams({ ...(skuId ? { sku: skuId } : {}), ...(bodegaId ? { bodega: bodegaId } : {}) }).toString();
  const hrefExportar = `/api/inventario/kardex/exportar${filtrosExportar ? `?${filtrosExportar}` : ""}`;

  return (
    <>
      <EncabezadoPagina titulo="Trazabilidad de inventario" descripcion="Cada movimiento de stock, con quién lo hizo y el saldo que dejó. No se edita ni se borra." />

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="SKU">
          <select name="sku" defaultValue={skuId ?? ""} className="zx-control">
            <option value="">Todos</option>
            {skusSimples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Bodega">
          <select name="bodega" defaultValue={bodegaId ?? ""} className="zx-control">
            <option value="">Todas</option>
            {lista.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">
            Filtrar
          </Boton>
          {(skuId || bodegaId) && (
            <BotonLink href="/panel/inventario/kardex" variante="fantasma">
              Limpiar
            </BotonLink>
          )}
          {/* <a> normal (no Link): es una descarga, no una navegación. */}
          <a href={hrefExportar} download className={clasesBoton("secundario", true)}>
            Descargar CSV
          </a>
        </div>
      </form>

      {resultado.filas.length === 0 ? (
        <EstadoVacio>Todavía no hay movimientos{skuId || bodegaId ? " con esos filtros" : ""}.</EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["Fecha", "Tipo", "SKU", "Bodega", "Disponible", "Reservado", "Saldo disp.", "Quién", "Nota"]}>
            {resultado.filas.map((f) => (
              <FilaTabla key={f.id}>
                <CeldaTabla>{f.ts.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })}</CeldaTabla>
                <CeldaTabla>
                  <Chip estado={ETIQUETA_TIPO[f.tipo]?.estado ?? "neutro"}>{ETIQUETA_TIPO[f.tipo]?.texto ?? f.tipo}</Chip>
                  <div className={styles.detalle}>{ETIQUETA_ORIGEN[f.origen] ?? f.origen}</div>
                </CeldaTabla>
                <CeldaTabla>
                  <strong><SkuCopiable sku={f.skuCodigo} /></strong>
                </CeldaTabla>
                <CeldaTabla>{f.bodegaNombre}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{f.deltaDisponible ? conSigno(f.deltaDisponible) : "—"}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{f.deltaReservado ? conSigno(f.deltaReservado) : "—"}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{f.saldoDisponible}</CeldaTabla>
                <CeldaTabla>{f.actorTipo === "sistema" ? "Sistema" : (f.actorNombre ?? "Persona")}</CeldaTabla>
                <CeldaTabla>{f.nota ?? ""}</CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>Página {resultado.pagina}</p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 && (
                <BotonLink href={hrefPagina(resultado.pagina - 1)} variante="secundario" chico>
                  Anterior
                </BotonLink>
              )}
              {resultado.hayMas && (
                <BotonLink href={hrefPagina(resultado.pagina + 1)} variante="secundario" chico>
                  Siguiente
                </BotonLink>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
