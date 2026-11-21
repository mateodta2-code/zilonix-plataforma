import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas as listarCuentasMl } from "@/lib/ml/cuentas";
import { listarCuentasConectadas as listarCuentasFalabella } from "@/lib/falabella/cuentas";
import { urlFotoGrandeMl } from "@/lib/ml/imagen-ml";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ESTADOS_UNIFICADOS } from "@/lib/pedidos/estados";
import { hayCuentasActivas, hrefPedidos, parsearFiltrosPedidos, PERIODOS, TAMANO_PAGINA_PEDIDOS, type CuentasEmpresa } from "@/lib/pedidos/filtros";
import { listarPedidosUnificados, type PedidoListado } from "@/lib/pedidos/listado";
import { formatearFechaPedido, formatearMontoEnMoneda, MARKETPLACES } from "@/lib/pedidos/marketplace";
import styles from "./page.module.css";

// Issue #422 — Pedidos es una pantalla INFORMATIVA para todo el equipo,
// al estilo de Despachos: una sola lista de Mercado Libre y Falabella, del
// más nuevo al más viejo. Nunca muestra ni lee costo, utilidad, comisión,
// flete ni empaque: eso sigue SOLO en Finanzas (el «Detalle día a día ·
// cuenta · producto», components/finanzas/DetalleDiaCuentaProducto.tsx,
// que ya no se usa acá). Por eso pide solo ventas.consultar, y no exige
// cuenta de Mercado Libre: un comercio solo con Falabella también entra.
//
// La ficha /panel/pedidos/[id] (solo ML) pide ventas.consultar y no
// muestra costos — su «Ver utilidad» ya va detrás de finanzas.consultar —,
// así que el enlace sale para cualquiera que vea esta lista.

const ETIQUETA_MARKETPLACE = { ml: "Mercado Libre", falabella: "Falabella" } as const;

async function puedeConsultarConfiguracion(usuarioId: string, empresaId: string): Promise<boolean> {
  try {
    await requierePermiso(usuarioId, empresaId, "configuracion", "consultar");
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

function TarjetaPedido({ pedido }: { pedido: PedidoListado }) {
  return (
    <Tarjeta>
      <div className={styles.tarjeta}>
        <div className={styles.columnaInfo}>
          <div className={styles.encabezadoTarjeta}>
            <span className={styles.sello} data-marketplace={pedido.marketplace}>
              {ETIQUETA_MARKETPLACE[pedido.marketplace]}
            </span>
            <Chip estado={pedido.estado.color}>{pedido.estado.etiqueta}</Chip>
          </div>

          {pedido.productos.length === 0 ? (
            <p className={styles.lineaDatos}>Sin detalle de productos.</p>
          ) : (
            <ul className={styles.productos}>
              {pedido.productos.map((producto, i) => (
                <li key={i} className={styles.producto}>
                  {producto.imagenUrl ? (
                    <FotoConZoom
                      src={producto.imagenUrl}
                      srcAmpliada={pedido.marketplace === "ml" ? urlFotoGrandeMl(producto.imagenUrl) : producto.imagenUrl}
                      alt={producto.nombre}
                      claseMiniatura={styles.imagen}
                    />
                  ) : (
                    <div className={styles.imagenVacia} aria-hidden="true" />
                  )}
                  <div className={styles.datosProducto}>
                    <span className={styles.nombreProducto}>{producto.nombre}</span>
                    <p className={styles.lineaDatos}>
                      Cantidad: {producto.cantidad} · SKU: {producto.sku ?? "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className={styles.lineaDatos}>
            Pedido #{pedido.pedidoIdExterno} · Tienda {pedido.cuenta} · {formatearFechaPedido(pedido.fecha, pedido.moneda)}
          </p>
        </div>

        <div className={styles.columnaValor}>
          <span className={styles.etiquetaValor}>Valor de la venta</span>
          <span className={styles.valor}>{formatearMontoEnMoneda(pedido.total, pedido.moneda)}</span>
          {pedido.marketplace === "ml" && (
            <BotonLink href={`/panel/pedidos/${pedido.id}`} variante="primario">
              Ver seguimiento
            </BotonLink>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}

export default async function PedidosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
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
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede ver Pedidos: hace falta acceso a Ventas.`} />;
  }

  const [cuentasMl, cuentasFalabella] = await Promise.all([listarCuentasMl(empresa.id), listarCuentasFalabella(empresa.id)]);
  // listarCuentasConectadas trae también las desconectadas (revisión de
  // Pablo, PR #433): siguen en el filtro, pero no evitan el aviso de conectar.
  const cuentas: CuentasEmpresa = {
    ml: cuentasMl.map((c) => ({ id: c.id, nickname: c.nickname, desconectada: c.desconectadaTs != null })),
    falabella: cuentasFalabella.map((c) => ({ id: c.id, nickname: c.nickname, desconectada: c.desconectadaTs != null })),
  };
  const filtros = parsearFiltrosPedidos(searchParams, cuentas, new Date());
  const { pedidos, hayMas } = await listarPedidosUnificados(empresa.id, filtros);
  const sinCuentas = !hayCuentasActivas(cuentas);
  const puedeConectar = sinCuentas && (await puedeConsultarConfiguracion(usuario.id, empresa.id));
  const hayFiltros = filtros.periodo !== "mes" || filtros.marketplace !== "todos" || filtros.tienda || filtros.estado || filtros.q;
  const primero = (filtros.pagina - 1) * TAMANO_PAGINA_PEDIDOS + 1;

  return (
    <>
      <EncabezadoPagina
        titulo="Pedidos"
        descripcion="Pedidos de Mercado Libre y Falabella, del más nuevo al más viejo."
        accion={
          <BotonLink href="/panel/despachos" variante="primario">
            Despachos
          </BotonLink>
        }
      />

      <form method="get" action="/panel/pedidos" className={styles.filtros}>
        <Campo etiqueta="Fecha">
          <select name="periodo" defaultValue={filtros.periodo} className="zx-control">
            {PERIODOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Desde (personalizado)">
          <input type="date" name="desde" defaultValue={filtros.desde ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta (personalizado)">
          <input type="date" name="hasta" defaultValue={filtros.hasta ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Marketplace">
          <select name="marketplace" defaultValue={filtros.marketplace} className="zx-control">
            {MARKETPLACES.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Tienda">
          <select name="tienda" defaultValue={filtros.tienda ? `${filtros.tienda.marketplace}:${filtros.tienda.id}` : ""} className="zx-control">
            <option value="">Todas</option>
            {cuentas.ml.map((c) => (
              <option key={`ml:${c.id}`} value={`ml:${c.id}`}>
                {c.nickname} · Mercado Libre{c.desconectada ? " (desconectada)" : ""}
              </option>
            ))}
            {cuentas.falabella.map((c) => (
              <option key={`falabella:${c.id}`} value={`falabella:${c.id}`}>
                {c.nickname} · Falabella{c.desconectada ? " (desconectada)" : ""}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={filtros.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_UNIFICADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.campoBusqueda}>
          <Campo etiqueta="Buscar">
            <input type="search" name="q" defaultValue={filtros.q ?? ""} placeholder="N.º de pedido, producto o SKU" className="zx-control" />
          </Campo>
        </div>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">
            Filtrar
          </Boton>
          {hayFiltros && (
            <BotonLink href="/panel/pedidos" variante="fantasma">
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {filtros.error && <p className={styles.avisoError}>{filtros.error}</p>}

      {pedidos.length === 0 ? (
        <EstadoVacio>
          {sinCuentas ? (
            puedeConectar ? (
              <span className={styles.vacioConAccion}>
                Para ver tus pedidos, primero conecta una cuenta de Mercado Libre o de Falabella.
                <BotonLink href="/panel/conectar-ml" variante="primario">
                  Conectar cuentas
                </BotonLink>
              </span>
            ) : (
              "Para ver tus pedidos, antes hace falta conectar una cuenta de Mercado Libre o de Falabella."
            )
          ) : (
            "No hay pedidos con estos filtros."
          )}
        </EstadoVacio>
      ) : (
        <>
          <div className={styles.lista}>
            {pedidos.map((p) => (
              <TarjetaPedido key={p.clave} pedido={p} />
            ))}
          </div>
          <nav className={styles.paginacion} aria-label="Paginación">
            <p className={styles.resumenPaginacion}>
              Página {filtros.pagina} · pedidos {primero}–{primero + pedidos.length - 1}
            </p>
            <div className={styles.botonesPaginacion}>
              {filtros.pagina > 1 && (
                <BotonLink href={hrefPedidos(filtros, filtros.pagina - 1)} variante="fantasma" chico>
                  Anterior
                </BotonLink>
              )}
              {hayMas && (
                <BotonLink href={hrefPedidos(filtros, filtros.pagina + 1)} variante="secundario" chico>
                  Siguiente
                </BotonLink>
              )}
            </div>
          </nav>
        </>
      )}

      <BotonLink href="/panel" variante="fantasma" className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
