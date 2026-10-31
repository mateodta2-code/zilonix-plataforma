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
  contarDespachosYaRecogidosSinImprimir,
  DIAS_VENTANA_DESPACHADOS,
  esFlex,
  estadoPlazo,
  ETIQUETA_TIPO_DESPACHO,
  etiquetaEstadoEnvio,
  fechaDespachoDe,
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
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ImpresionMasivaForm } from "./ImpresionMasivaForm";
import { TarjetaDespachoCliente } from "./TarjetaDespachoCliente";
import styles from "./page.module.css";

// Las 3 pestañas reales de la pantalla — "impresion" es nueva
// (reportado por Mateo: la impresión masiva vivía adentro de
// Pendientes, mezclada con las tarjetas). listarTarjetasDespacho solo
// conoce "pendientes"/"despachados" (lib/ml/despachos.ts) — en
// "impresion" ni siquiera se le llama, no hace falta esa data acá.
type PestañaPagina = "pendientes" | "despachados" | "impresion";

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
// más abajo) se mantiene intacta — mismo alcance, mismo Route
// Handler — pero reportado por Mateo tras el PR #312: mezclada con
// las tarjetas de Pendientes se perdía de vista. Ahora vive en su
// propia pestaña ("Impresión masiva de guías"), al lado de
// "Despachados" (antes "Despachados hoy" — ahora muestra los últimos
// DIAS_VENTANA_DESPACHADOS días, no solo hoy).
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
  const valorPestaña = normalizarParametro(searchParams.pestaña);
  const pestañaFiltro: PestañaPagina = valorPestaña === "despachados" ? "despachados" : valorPestaña === "impresion" ? "impresion" : "pendientes";
  // listarTarjetasDespacho solo distingue pendientes/despachados — en
  // la pestaña de impresión ni siquiera hace falta pedirle esa data
  // (ni gastar el backfill de plazo/refresco de estado en vivo por
  // algo que no se va a mostrar).
  const pestañaParaTarjetas: PestañaDespachos = pestañaFiltro === "despachados" ? "despachados" : "pendientes";

  const [cuentas, cuentasConError, tarjetas] = await Promise.all([
    listarCuentasConectadas(empresa.id),
    listarCuentasConErrorDespacho(empresa.id),
    pestañaFiltro === "impresion" ? Promise.resolve([]) : listarTarjetasDespacho(empresa.id, { cuentaId: cuentaFiltro, tipo: tipoFiltro, pestaña: pestañaParaTarjetas }),
  ]);
  const ahora = new Date();
  // Despachados agrupa por la fecha REAL del despacho (fechaDespachoDe:
  // despachado_ts si una persona lo marcó, si no actualizado_ts), no
  // por fecha de venta — un pedido vendido hace 10 días pero
  // despachado hoy tiene que caer en "Hoy".
  const grupos = agruparDespachosPorDia(tarjetas, ahora, pestañaFiltro === "despachados" ? fechaDespachoDe : undefined);

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
          { etiqueta: "Despachados", href: hrefConFiltros(filtrosBase, { pestaña: "despachados" }), activa: pestañaFiltro === "despachados" },
          { etiqueta: "Impresión masiva de guías", href: hrefConFiltros(filtrosBase, { pestaña: "impresion" }), activa: pestañaFiltro === "impresion" },
        ]}
      />

      {pestañaFiltro === "impresion" ? (
        <ImpresionMasiva empresaId={empresa.id} />
      ) : (
        <>
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
            <EstadoVacio>
              {pestañaFiltro === "despachados" ? `Nada despachado en los últimos ${DIAS_VENTANA_DESPACHADOS} días.` : "No hay despachos pendientes."}
            </EstadoVacio>
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
                      origenDespacho={d.origenDespacho}
                      imprimible={d.imprimible}
                      puedeModificar={puedeModificar}
                      ventanaDeshacerMs={VENTANA_DESHACER_MS}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}

      <BotonLink href="/panel/pedidos" variante="fantasma" chico className={styles.volver}>
        Volver a pedidos
      </BotonLink>
    </>
  );
}

// Impresión masiva de siempre (tarea 2.10 / issue "tabla completa de
// despachos") — mismo alcance (imprimible=true y sin etiqueta
// impresa; mismo Route Handler, que nunca confía en lo que mande el
// formulario y revalida contra listarDespachosPendientes de nuevo).
// <Tarjeta> le da el mismo borde degradado plata-azul y fondo oscuro
// del resto de /panel. El form en sí (ImpresionMasivaForm) es
// cliente — issue "ocultar imprimir en recogidas": antes era un
// <form action=... target="_blank">, que al fallar (ej. una venta ya
// recogida en el lote) abría una pestaña con el JSON crudo del error;
// ahora pide con fetch y solo abre una pestaña (con un blob: URL
// propio) si de verdad llegó un PDF.
async function ImpresionMasiva({ empresaId }: { empresaId: string }) {
  const [resultado, saltadas] = await Promise.all([listarDespachosFiltrados(empresaId, {}), contarDespachosYaRecogidosSinImprimir(empresaId)]);
  return (
    <Tarjeta>
      <h2 className={styles.tituloGrupo}>Impresión masiva de guías</h2>
      {saltadas > 0 && (
        <p className={styles.nota}>
          {saltadas} {saltadas === 1 ? "venta no se incluye" : "ventas no se incluyen"} acá porque la transportadora ya las recogió (su guía ya no
          está disponible).
        </p>
      )}
      {resultado.total === 0 ? (
        <EstadoVacio>No hay despachos pendientes de imprimir.</EstadoVacio>
      ) : (
        <ImpresionMasivaForm filas={resultado.despachos} total={resultado.total} tamanoPagina={TAMANO_PAGINA_DESPACHOS} etiquetaTipo={ETIQUETA_TIPO_DESPACHO} />
      )}
    </Tarjeta>
  );
}
