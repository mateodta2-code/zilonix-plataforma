import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { ESTADOS_PEDIDO_FILTRO, listarPedidosFiltrados, TAMANO_PAGINA_PEDIDOS } from "@/lib/ml/pedidos";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

type FiltrosUrl = { q?: string; estado?: string; desde?: string; hasta?: string; orden?: string; pagina?: string };

// Mapeo de color del Chip — "paid" es el único que sabemos con certeza
// que SÍ corre en pedidos reales hoy (ver el comentario de
// ESTADOS_PEDIDO_FILTRO en lib/ml/pedidos.ts); el resto es la
// clasificación razonable de la API pública de Mercado Libre. Un
// estado real que no esté acá (porque esta lista no tiene precedente
// confirmado contra producción) simplemente se pinta neutro — nunca
// rompe la pantalla.
function colorEstadoPedido(estado: string): EstadoChip {
  if (estado === "paid") return "exito";
  if (estado === "cancelled" || estado === "invalid") return "peligro";
  if (estado === "confirmed" || estado === "payment_required" || estado === "payment_in_process") return "aviso";
  return "neutro";
}

// numeric de Postgres llega como string — Number() UNA vez, solo para
// formatear (nunca para sumar ni comparar), es seguro para un monto de
// venta real. "con su moneda": se antepone el código tal cual viene de
// Mercado Libre (COP, ARS...), no un símbolo de Intl que podría no
// calzar con el código real guardado.
function formatoMonto(moneda: string, total: string): string {
  return `${moneda} ${Number(total).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatoFechaColombia(fecha: Date | string): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

// "Anterior"/"Siguiente" tienen que preservar el resto de los filtros
// de la URL y solo cambiar ?pagina= — arma el href a mano en vez de
// mutar searchParams (que Next.js entrega como objeto de solo lectura).
function hrefConPagina(filtros: FiltrosUrl, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  if (filtros.orden) params.set("orden", filtros.orden);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/pedidos?${qs}` : "/panel/pedidos";
}

// Tarea 2.7 / issue "tabla completa de pedidos" — búsqueda, filtro por
// estado y fecha, orden y paginación, todo en la URL (?q=, ?estado=,
// ?desde=, ?hasta=, ?orden=, ?pagina=) para que se pueda compartir o
// recargar el link con los mismos filtros. Toda la validación real
// (lista blanca de estado/orden, página entera positiva) vive en
// listarPedidosFiltrados() (lib/ml/pedidos.ts) — esta página solo lee
// la URL y pinta el resultado.
export default async function PedidosPage({ searchParams }: { searchParams: FiltrosUrl }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const paginaPedida = Number(searchParams.pagina);
  const resultado = await listarPedidosFiltrados(empresa.id, {
    busqueda: searchParams.q,
    estado: searchParams.estado,
    desde: searchParams.desde,
    hasta: searchParams.hasta,
    orden: searchParams.orden,
    pagina: Number.isFinite(paginaPedida) ? paginaPedida : undefined,
  });

  const hayFiltrosActivos = Boolean(searchParams.q || searchParams.estado || searchParams.desde || searchParams.hasta || searchParams.orden);
  const desdeFila = (resultado.pagina - 1) * TAMANO_PAGINA_PEDIDOS + 1;
  const hastaFila = Math.min(resultado.pagina * TAMANO_PAGINA_PEDIDOS, resultado.total);

  return (
    <>
      <EncabezadoPagina
        titulo="Pedidos"
        accion={
          <BotonLink href="/panel/despachos" variante="secundario" chico>
            Despachos
          </BotonLink>
        }
      />

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Buscar">
          {/* Solo busca por número de pedido: pedidos no guarda
              comprador y todavía no tiene un enlace propio con SKU
              (ver el comentario de ESTADOS_PEDIDO_FILTRO/búsqueda en
              lib/ml/pedidos.ts) — nunca se inventa una columna que no
              existe. */}
          <input type="search" name="q" defaultValue={searchParams.q ?? ""} placeholder="Número de pedido" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={searchParams.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_PEDIDO_FILTRO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Desde">
          <input type="date" name="desde" defaultValue={searchParams.desde ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Ordenar por">
          <select name="orden" defaultValue={searchParams.orden ?? "fecha_desc"} className="zx-control">
            <option value="fecha_desc">Más recientes primero</option>
            <option value="fecha_asc">Más antiguos primero</option>
            <option value="total_desc">Total: mayor a menor</option>
            <option value="total_asc">Total: menor a mayor</option>
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltrosActivos && (
            <BotonLink href="/panel/pedidos" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.pedidos.length === 0 ? (
        <EstadoVacio>
          {hayFiltrosActivos ? (
            <span className={styles.vacioConAccion}>
              Ningún pedido coincide con esos filtros.
              <BotonLink href="/panel/pedidos" variante="secundario" chico>
                Limpiar filtros
              </BotonLink>
            </span>
          ) : (
            <>
              Todavía no hay pedidos importados — conecta una cuenta de Mercado Libre en{" "}
              <Link href="/panel/conectar-ml">Conectar Mercado Libre</Link>.
            </>
          )}
        </EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["Pedido", "Fecha", "Total", "Estado"]}>
            {resultado.pedidos.map((pedido) => (
              <FilaTabla key={pedido.id}>
                <CeldaTabla>
                  <Link href={`/panel/pedidos/${pedido.id}`} className={styles.enlacePedido}>
                    #{pedido.pedidoIdExterno}
                  </Link>
                </CeldaTabla>
                <CeldaTabla className={styles.celdaFecha}>{formatoFechaColombia(pedido.fecha)}</CeldaTabla>
                <CeldaTabla className={styles.celdaTotal}>{formatoMonto(pedido.moneda, pedido.total)}</CeldaTabla>
                <CeldaTabla>
                  <Chip estado={colorEstadoPedido(pedido.estado)}>{pedido.estado}</Chip>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>

          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Mostrando {desdeFila}–{hastaFila} de {resultado.total}
            </p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 ? (
                <BotonLink href={hrefConPagina(searchParams, resultado.pagina - 1)} variante="secundario" chico>
                  Anterior
                </BotonLink>
              ) : (
                <span className={clasesBoton("secundario", true)} aria-disabled="true">
                  Anterior
                </span>
              )}
              {resultado.pagina < resultado.totalPaginas ? (
                <BotonLink href={hrefConPagina(searchParams, resultado.pagina + 1)} variante="secundario" chico>
                  Siguiente
                </BotonLink>
              ) : (
                <span className={clasesBoton("secundario", true)} aria-disabled="true">
                  Siguiente
                </span>
              )}
            </div>
          </div>
        </>
      )}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
