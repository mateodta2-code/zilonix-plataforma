import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import {
  agruparDespachosPorDia,
  esFlex,
  estadoPlazo,
  ETIQUETA_TIPO_DESPACHO,
  etiquetaEstadoEnvio,
  formatoPlazoChip,
  listarCuentasConErrorDespacho,
  listarDespachosFiltrados,
  listarTarjetasDespacho,
  TAMANO_PAGINA_DESPACHOS,
  TIPOS_DESPACHO_FILTRO,
  VENTANA_DESHACER_MS,
  type PestañaDespachos,
} from "@/lib/ml/despachos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { TarjetaDespachoCliente } from "./TarjetaDespachoCliente";
import styles from "./page.module.css";

function colorEstadoDespacho(estado: string | null): EstadoChip {
  if (estado === "ready_to_ship") return "exito";
  if (estado === "handling" || estado === "pending") return "aviso";
  return "neutro";
}

function formatoFechaColombia(fecha: Date | string): string {
  return new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

// Etiquetas de tarjeta (con emoji) — punto 5 de la tarea, confirmado
// contra el Zilonix OS actual (LOGISTIC_LABELS en
// components/negocio/MercadoLibreDespachos.js). Distinto de
// ETIQUETA_TIPO_DESPACHO (lib/ml/despachos.ts, texto plano): esa sigue
// siendo la del filtro y de la tabla compacta de impresión masiva,
// esta es solo para el badge grande de la tarjeta.
const ETIQUETA_TIPO_TARJETA: Record<string, string> = {
  self_service: "⚡ Flex",
  xd_drop_off: "📍 Agencia (Places)",
  cross_docking: "🚚 Colecta",
  otro: "Otro",
};

function hrefConFiltros(base: Record<string, string | undefined>, cambios: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const combinados = { ...base, ...cambios };
  for (const [clave, valor] of Object.entries(combinados)) {
    if (valor) params.set(clave, valor);
  }
  const qs = params.toString();
  return qs ? `/panel/despachos?${qs}` : "/panel/despachos";
}

// Fase 1 de Despachos (issue "Despachos") — tarjetas agrupadas por
// plazo, en vez de la tabla simple de la tarea 2.10. La impresión
// masiva de siempre (listarDespachosPendientes/obtenerEtiquetasPdf,
// más abajo) se mantiene intacta, solo que ahora vive como una
// sección aparte debajo de las tarjetas — "Mantén la impresión masiva
// de PDF actual", pedido explícito de la tarea, nunca se rediseñó esa
// parte.
export default async function DespachosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
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
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeModificar = Boolean(miMembresia && tienePermiso(miMembresia.permisos, "ventas", "modificar"));

  const cuentaFiltro = normalizarParametro(searchParams.cuenta);
  const tipoFiltro = normalizarParametro(searchParams.tipo);
  const pestañaFiltro: PestañaDespachos = normalizarParametro(searchParams.pestaña) === "despachados_hoy" ? "despachados_hoy" : "pendientes";

  const [cuentas, cuentasConError, tarjetas] = await Promise.all([
    listarCuentasConectadas(empresa.id),
    listarCuentasConErrorDespacho(empresa.id),
    listarTarjetasDespacho(empresa.id, { cuentaId: cuentaFiltro, tipo: tipoFiltro, pestaña: pestañaFiltro }),
  ]);
  const ahora = new Date();
  const grupos = agruparDespachosPorDia(tarjetas, ahora);

  const filtrosBase = { cuenta: cuentaFiltro, tipo: tipoFiltro };

  return (
    <>
      <EncabezadoPagina
        titulo="Despachos"
        descripcion={
          <>
            Órdenes ya pagas, listas para empacar — no incluye Full.
            <span className={styles.ultimaActualizacion}> Actualizado: {formatoFechaColombia(ahora)}.</span>
          </>
        }
      />

      {cuentasConError.length > 0 && (
        <div className={styles.aviso}>
          <p className={styles.avisoTitulo}>No se pudieron revisar estas cuentas de Mercado Libre:</p>
          <ul className={styles.avisoLista}>
            {cuentasConError.map((c) => (
              <li key={c.cuentaId}>
                <strong>{c.nickname}</strong> — {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pestanas
        pestanas={[
          { etiqueta: "Pendientes", href: hrefConFiltros(filtrosBase, { pestaña: undefined }), activa: pestañaFiltro === "pendientes" },
          { etiqueta: "Despachados hoy", href: hrefConFiltros(filtrosBase, { pestaña: "despachados_hoy" }), activa: pestañaFiltro === "despachados_hoy" },
        ]}
      />

      <form method="get" className={styles.filtros}>
        <input type="hidden" name="pestaña" value={pestañaFiltro} />
        <Campo etiqueta="Cuenta">
          <select name="cuenta" defaultValue={cuentaFiltro ?? ""} className="zx-control">
            <option value="">Todas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Tipo">
          <select name="tipo" defaultValue={tipoFiltro ?? ""} className="zx-control">
            <option value="">Todos</option>
            {TIPOS_DESPACHO_FILTRO.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_DESPACHO[t]}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {(cuentaFiltro || tipoFiltro) && (
            <BotonLink href={hrefConFiltros({}, { pestaña: pestañaFiltro })} variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {tarjetas.length === 0 ? (
        <EstadoVacio>{pestañaFiltro === "despachados_hoy" ? "Todavía no se despachó nada hoy." : "No hay despachos pendientes."}</EstadoVacio>
      ) : (
        grupos.map((grupo) => (
          <section key={grupo.etiqueta} className={styles.grupoDia}>
            <h2 className={styles.tituloGrupo}>{grupo.etiqueta}</h2>
            <div className={styles.listaAncha}>
              {grupo.despachos.map((d) => (
                <TarjetaDespachoCliente
                  key={d.id}
                  id={d.id}
                  logisticType={d.logisticType}
                  status={d.status}
                  estadoTraducido={etiquetaEstadoEnvio(d.status, null)}
                  despachadoTs={d.despachadoTs}
                  guiaVistaTs={d.guiaVistaTs}
                  cuentaNickname={d.cuentaNickname}
                  pedidoIdExterno={d.pedidoIdExterno}
                  fechaPedido={d.fechaPedido}
                  comprador={d.comprador}
                  bodegaAsignada={d.bodegaAsignada}
                  items={d.items}
                  etiquetaTipo={ETIQUETA_TIPO_TARJETA[d.logisticType ?? "otro"] ?? "Otro"}
                  esFlex={esFlex(d.logisticType)}
                  chipPlazo={formatoPlazoChip(d.slaExpectedDate)}
                  estadoPlazo={estadoPlazo(d.slaExpectedDate, ahora)}
                  estadoEnvioTexto={etiquetaEstadoEnvio(d.status, d.substatus)}
                  puedeModificar={puedeModificar}
                  ventanaDeshacerMs={VENTANA_DESHACER_MS}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {pestañaFiltro === "pendientes" && <ImpresionMasiva empresaId={empresa.id} />}

      <BotonLink href="/panel/pedidos" variante="fantasma" chico className={styles.volver}>
        Volver a pedidos
      </BotonLink>
    </>
  );
}

// Impresión masiva de siempre (tarea 2.10 / issue "tabla completa de
// despachos") — sin tocar: mismo alcance (imprimible=true y sin
// etiqueta impresa), mismo Route Handler, nunca confía en lo que
// mande el formulario (ese Route Handler revalida contra
// listarDespachosPendientes de nuevo).
async function ImpresionMasiva({ empresaId }: { empresaId: string }) {
  const resultado = await listarDespachosFiltrados(empresaId, {});
  if (resultado.total === 0) return null;
  return (
    <section className={styles.grupoDia}>
      <h2 className={styles.tituloGrupo}>Impresión masiva de guías</h2>
      <form action="/api/ml/despachos/etiquetas" method="POST" target="_blank" className={styles.form}>
        <Tabla encabezados={["", "Envío", "Tipo", "Estado", "Actualizado"]}>
          {resultado.despachos.map((d) => (
            <FilaTabla key={d.id}>
              <CeldaTabla>
                <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked aria-label={`Seleccionar envío ${d.shipmentIdExterno}`} />
              </CeldaTabla>
              <CeldaTabla>#{d.shipmentIdExterno}</CeldaTabla>
              <CeldaTabla>{ETIQUETA_TIPO_DESPACHO[d.logisticType ?? "otro"] ?? d.logisticType}</CeldaTabla>
              <CeldaTabla>
                <Chip estado={colorEstadoDespacho(d.status)}>{d.status ?? "—"}</Chip>
              </CeldaTabla>
              <CeldaTabla className={styles.celdaFecha}>{formatoFechaColombia(d.actualizadoTs)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
        <p className={styles.resumenPaginacion}>
          Mostrando hasta {TAMANO_PAGINA_DESPACHOS} de {resultado.total} pendientes de imprimir.
        </p>
        <Boton type="submit" className={styles.botonImprimir}>
          Imprimir etiquetas seleccionadas
        </Boton>
        <p className={styles.nota}>
          Solo imprime lo seleccionado de esta lista. Si hay despachos de varias cuentas de Mercado Libre, selecciona primero los de una sola
          cuenta.
        </p>
      </form>
    </section>
  );
}
