import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { estadoVisiblePedido } from "@/lib/ml/estado-visible-pedido";
import { ESTADOS_PEDIDO_FILTRO, listarPedidosFiltrados, TAMANO_PAGINA_PEDIDOS } from "@/lib/ml/pedidos";
import { CUENTA_TODAS, leerCuentaMlDeQuery, PARAM_CUENTA } from "@/lib/ml/selector-cuenta";
import { formatearMonto } from "@/lib/panel-kpis";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Next entrega string[] cuando la misma clave viene repetida
// (?q=a&q=b). normalizarParametro se queda con el primero.
type ParametroUrl = string | string[] | undefined;
type FiltrosUrl = {
  q?: ParametroUrl;
  estado?: ParametroUrl;
  desde?: ParametroUrl;
  hasta?: ParametroUrl;
  orden?: ParametroUrl;
  pagina?: ParametroUrl;
  [PARAM_CUENTA]?: ParametroUrl;
};
// `cuenta` es el id ya validado contra las cuentas de esta empresa
// (leerCuentaMlDeQuery), nunca el texto crudo de la URL.
type FiltrosNormalizados = { q?: string; estado?: string; desde?: string; hasta?: string; orden?: string; cuenta?: string };

// numeric de Postgres llega como string. Se formatea con el mismo
// formatearMonto de los KPIs (lib/panel-kpis.ts), que nunca pasa el
// monto por Number() — un numeric(14,2) grande se sale del entero
// seguro y pierde centavos. "con su moneda": se antepone el código tal
// cual viene de Mercado Libre (COP, ARS...), no un símbolo de Intl que
// podría no calzar con el código real guardado.
function formatoMonto(moneda: string, total: string): string {
  return `${moneda} ${formatearMonto(total)}`;
}

function formatoFechaColombia(fecha: Date | string): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

// "Anterior"/"Siguiente" tienen que preservar el resto de los filtros
// de la URL y solo cambiar ?pagina= — arma el href a mano en vez de
// mutar searchParams (que Next.js entrega como objeto de solo lectura).
function hrefConPagina(filtros: FiltrosNormalizados, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  if (filtros.orden) params.set("orden", filtros.orden);
  if (filtros.cuenta) params.set(PARAM_CUENTA, filtros.cuenta);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/pedidos?${qs}` : "/panel/pedidos";
}

// Tarea 2.7 / issue "tabla completa de pedidos" — búsqueda, filtro por
// estado, fecha y cuenta de ML (#166), orden y paginación, todo en la URL
// (?q=, ?estado=, ?desde=, ?hasta=, ?cuenta=, ?orden=, ?pagina=) para que se pueda compartir o
// recargar el link con los mismos filtros. Toda la validación real
// (lista blanca de estado/orden, página entera segura, fechas,
// escape de la búsqueda) vive en listarPedidosFiltrados()
// (lib/ml/pedidos.ts) y en lib/filtros-listado.ts — esta página solo
// lee la URL y pinta el resultado. El aviso "todavía no hay pedidos"
// sale únicamente cuando el total es 0: una página fuera de rango
// se acota a la última y no puede vaciar la tabla si sí hay filas.
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

  // Las 2 cuentas (o las que tenga la empresa) en una sola lista; el
  // filtro elige una. Un id que no es de esta empresa queda en Todas,
  // sin error. Las cuentas desconectadas también salen: su histórico
  // sigue siendo de la empresa.
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, searchParams[PARAM_CUENTA]);

  const filtros: FiltrosNormalizados = {
    q: normalizarParametro(searchParams.q),
    estado: normalizarParametro(searchParams.estado),
    desde: normalizarParametro(searchParams.desde),
    hasta: normalizarParametro(searchParams.hasta),
    orden: normalizarParametro(searchParams.orden),
    cuenta: cuentaId ?? undefined,
  };
  const resultado = await listarPedidosFiltrados(empresa.id, {
    busqueda: filtros.q,
    estado: filtros.estado,
    desde: filtros.desde,
    hasta: filtros.hasta,
    orden: filtros.orden,
    cuentaId,
    pagina: normalizarParametro(searchParams.pagina),
  });

  // Un ?q= que queda vacío después de trim no cuenta como filtro: si
  // no, con cero pedidos reales la pantalla diría "ningún pedido
  // coincide" en vez de "todavía no hay pedidos".
  const hayFiltrosActivos = Boolean(
    normalizarTextoBusqueda(filtros.q) || filtros.estado || filtros.desde || filtros.hasta || filtros.orden || filtros.cuenta
  );
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
          <input type="search" name="q" defaultValue={filtros.q ?? ""} placeholder="Número de pedido" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={filtros.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_PEDIDO_FILTRO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        {/* Un <select> más del mismo formulario, no SelectorCuentaMl:
            ese componente arma su propio formulario aparte. Se aplica
            con el botón Filtrar (Server Component, sin onChange). */}
        <Campo etiqueta="Cuenta de Mercado Libre">
          <select name={PARAM_CUENTA} defaultValue={cuentaId ?? CUENTA_TODAS} className="zx-control">
            <option value={CUENTA_TODAS}>Todas</option>
            {cuentas.map((cuenta) => (
              <option key={cuenta.id} value={cuenta.id}>
                {cuenta.apodo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Desde">
          <input type="date" name="desde" defaultValue={filtros.desde ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" name="hasta" defaultValue={filtros.hasta ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Ordenar por">
          <select name="orden" defaultValue={filtros.orden ?? "fecha_desc"} className="zx-control">
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

      {resultado.total === 0 ? (
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
          {/* #166 — filas tipo tarjeta en vez de la tabla. Cada fila es
              un link al detalle, como antes. El cuadro de la izquierda
              es el lugar de la foto del producto: hoy no se guarda (llega
              con #129/#130 y el cambio de CSP img-src), así que va vacío
              y igual en todas las filas — nunca una imagen externa ni un
              texto inventado. */}
          <ul className={styles.lista}>
            {resultado.pedidos.map((pedido) => {
              const estado = estadoVisiblePedido(pedido.estado, pedido.estadoEnvio);
              return (
                <li key={pedido.id}>
                  <Link href={`/panel/pedidos/${pedido.id}`} className={styles.fila}>
                    <div className={styles.foto} aria-hidden="true" />
                    <div className={styles.cuerpo}>
                      <div className={styles.encabezadoFila}>
                        <span className={styles.cuenta}>{pedido.apodoCuenta}</span>
                        <span className={styles.numeroPedido}>#{pedido.pedidoIdExterno}</span>
                      </div>
                      <div className={styles.datosFila}>
                        <span className={styles.fecha}>{formatoFechaColombia(pedido.fecha)}</span>
                        <span className={styles.total}>{formatoMonto(pedido.moneda, pedido.total)}</span>
                      </div>
                    </div>
                    <span className={styles.estado}>
                      <Chip estado={estado.color}>{estado.etiqueta}</Chip>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Mostrando {desdeFila}–{hastaFila} de {resultado.total}
            </p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 ? (
                <BotonLink href={hrefConPagina(filtros, resultado.pagina - 1)} variante="secundario" chico>
                  Anterior
                </BotonLink>
              ) : (
                <span className={clasesBoton("secundario", true)} aria-disabled="true">
                  Anterior
                </span>
              )}
              {resultado.pagina < resultado.totalPaginas ? (
                <BotonLink href={hrefConPagina(filtros, resultado.pagina + 1)} variante="secundario" chico>
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
