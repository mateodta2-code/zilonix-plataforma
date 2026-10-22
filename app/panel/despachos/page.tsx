import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { ESTADOS_DESPACHO_FILTRO, listarDespachosFiltrados, TAMANO_PAGINA_DESPACHOS } from "@/lib/ml/despachos";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

type FiltrosUrl = { q?: string; estado?: string; desde?: string; hasta?: string; orden?: string; pagina?: string };

const ETIQUETA_LOGISTIC_TYPE: Record<string, string> = {
  self_service: "Flex",
  xd_drop_off: "Places",
  cross_docking: "Colecta",
  fulfillment: "Full",
  otro: "Otro",
};

function colorEstadoDespacho(estado: string | null): EstadoChip {
  if (estado === "ready_to_ship") return "exito";
  if (estado === "handling" || estado === "pending") return "aviso";
  return "neutro";
}

function formatoFechaColombia(fecha: Date | string): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

// "Anterior"/"Siguiente" preservan el resto de los filtros de la URL y
// solo cambian ?pagina= — mismo criterio que /panel/pedidos.
function hrefConPagina(filtros: FiltrosUrl, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  if (filtros.orden) params.set("orden", filtros.orden);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/despachos?${qs}` : "/panel/despachos";
}

// Tarea 2.10 / issue "tabla completa de despachos" — mismo alcance de
// siempre (imprimible=true y sin etiqueta impresa — Full nunca aparece
// acá, ver lib/ml/despachos.ts), ahora con búsqueda por número de
// envío, filtro de estado, rango de fechas (por actualizado_ts — este
// despacho no guarda una fecha propia, ver el comentario de
// listarDespachosFiltrados), orden y paginación de 25, todo validado
// en lib/ml/despachos.ts (temporal, local a ese archivo hasta que el
// helper compartido de Pedidos, PR #107, esté fusionado). El form de
// impresión masiva sigue trabajando solo con lo que se ve en la página
// actual — el Route Handler (/api/ml/despachos/etiquetas) revalida
// igual contra TODO lo pendiente real, nunca confía en lo que mande el
// formulario.
export default async function DespachosPage({ searchParams }: { searchParams: FiltrosUrl }) {
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
  const resultado = await listarDespachosFiltrados(empresa.id, {
    busqueda: searchParams.q,
    estado: searchParams.estado,
    desde: searchParams.desde,
    hasta: searchParams.hasta,
    orden: searchParams.orden,
    pagina: Number.isFinite(paginaPedida) ? paginaPedida : undefined,
  });

  const hayFiltrosActivos = Boolean(searchParams.q || searchParams.estado || searchParams.desde || searchParams.hasta || searchParams.orden);
  const desdeFila = (resultado.pagina - 1) * TAMANO_PAGINA_DESPACHOS + 1;
  const hastaFila = Math.min(resultado.pagina * TAMANO_PAGINA_DESPACHOS, resultado.total);

  return (
    <>
      <EncabezadoPagina titulo="Despachos pendientes" />

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Buscar">
          {/* Único texto libre real en despachos_ml: el número de
              envío (shipmentIdExterno). No hay comprador ni pedido
              buscable acá — ver el comentario del mismo nombre en
              lib/ml/pedidos.ts para el caso análogo. */}
          <input type="search" name="q" defaultValue={searchParams.q ?? ""} placeholder="Número de envío" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={searchParams.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_DESPACHO_FILTRO.map((e) => (
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
          <select name="orden" defaultValue={searchParams.orden ?? "actualizado_desc"} className="zx-control">
            <option value="actualizado_desc">Más recientes primero</option>
            <option value="actualizado_asc">Más antiguos primero</option>
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltrosActivos && (
            <BotonLink href="/panel/despachos" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.despachos.length === 0 ? (
        <EstadoVacio>
          {hayFiltrosActivos ? (
            <span className={styles.vacioConAccion}>
              Ningún despacho pendiente coincide con esos filtros.
              <BotonLink href="/panel/despachos" variante="secundario" chico>
                Limpiar filtros
              </BotonLink>
            </span>
          ) : (
            "No hay despachos pendientes de imprimir."
          )}
        </EstadoVacio>
      ) : (
        <form action="/api/ml/despachos/etiquetas" method="POST" target="_blank" className={styles.form}>
          <Tabla encabezados={["", "Envío", "Tipo", "Estado", "Actualizado"]}>
            {resultado.despachos.map((d) => (
              <FilaTabla key={d.id}>
                <CeldaTabla>
                  <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked aria-label={`Seleccionar envío ${d.shipmentIdExterno}`} />
                </CeldaTabla>
                <CeldaTabla>#{d.shipmentIdExterno}</CeldaTabla>
                <CeldaTabla>{ETIQUETA_LOGISTIC_TYPE[d.logisticType ?? "otro"] ?? d.logisticType}</CeldaTabla>
                <CeldaTabla>
                  <Chip estado={colorEstadoDespacho(d.status)}>{d.status ?? "—"}</Chip>
                </CeldaTabla>
                <CeldaTabla className={styles.celdaFecha}>{formatoFechaColombia(d.actualizadoTs)}</CeldaTabla>
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

          <Boton type="submit" className={styles.botonImprimir}>
            Imprimir etiquetas seleccionadas
          </Boton>
          <p className={styles.nota}>
            Solo imprime lo seleccionado de esta página. Si hay despachos de varias cuentas de Mercado Libre, selecciona primero los de una sola
            cuenta.
          </p>
        </form>
      )}

      <BotonLink href="/panel/pedidos" variante="fantasma" chico className={styles.volver}>
        Volver a pedidos
      </BotonLink>
    </>
  );
}
