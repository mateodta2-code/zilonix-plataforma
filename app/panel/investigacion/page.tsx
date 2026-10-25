import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlNoDisponibleError, MlRespuestaInesperadaError, MlSinPermisoAppError } from "@/lib/ml/cliente";
import { CandadoDeRenovacionError, CuentaDesconectadaError, CuentaMlNoEncontradaError, RenovacionTokenFallidaError } from "@/lib/ml/cuentas";
import {
  buscarInvestigacionProducto,
  LimiteBusquedasError,
  SinCuentaMlError,
  TerminoInvalidoError,
  type ResultadoInvestigacion,
} from "@/lib/ml/investigacion";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { InsigniaExtension } from "@/components/marco/InsigniaExtension";
import { Pestanas, type Pestana } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "./page.module.css";

// Issue #174 (Parte 1) + #197 (Refs, "Investigación Selltrix
// combinada") — módulo "Investigación" de Zilonix OS, API oficial de
// Mercado Libre + lo que la extensión de Chrome puede confirmar
// cuando la persona tiene una página abierta. Todo el cálculo real
// vive en lib/ml/investigacion.ts; esta página solo lee el término de
// la URL (?termino=, mismo patrón que ?q= en /panel/pedidos) y la
// pestaña activa (?tab=), y pinta el resultado o el aviso.
//
// Pedido urgente de Sharel (2026-10-24): "no dejar ventas en cero" —
// vendidos (sold_quantity) y ventas/mes estimadas "estilo Selltrix"
// ahora SÍ se calculan con datos de la API (lib/ml/estimacionVentas.ts,
// issue #197) — antes esta Parte 1 descartaba "vendidos" por completo
// (ver la nota vieja, abajo), confundiendo la restricción real de ML
// sobre /visits/items (vistas) con sold_quantity, que es un campo
// DISTINTO y SÍ confirmado disponible por este mismo PR (ver
// lib/seguimiento/lector.ts, obtenerFotoItemMl, issue #175 — la misma
// llamada que ya usa Seguimiento para competidores ajenos).
//
// Amazon, Temu, AliExpress, Shein y Alibaba: solo vía la extensión de
// Zilonix, con la página de ese producto ya abierta en el navegador —
// nunca un scraper del lado del servidor (issue #197, punto 7). Esta
// pantalla sigue siendo solo Mercado Libre Colombia por API.

type Tab = "demanda" | "mercado" | "estrategia";

function esTabValida(valor: string | undefined): Tab {
  return valor === "mercado" || valor === "estrategia" ? valor : "demanda";
}

function money(n: number): string {
  // Issue #197/#201 — ventasMesEst/facturacionEst (lib/ml/estimacionVentas.ts,
  // #203) devuelven floats sin redondear (una proyección, no un
  // conteo entero) — se redondea solo acá, al mostrarlo, nunca en el
  // dato guardado.
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function numero(n: number): string {
  return Math.round(n).toLocaleString("es-CO");
}

export default async function InvestigacionPage({ searchParams }: { searchParams: { termino?: string | string[]; tab?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const terminoUrl = normalizarParametro(searchParams.termino);
  const termino = normalizarTextoBusqueda(terminoUrl) ?? "";
  const tab = esTabValida(normalizarParametro(searchParams.tab));

  let resultado: ResultadoInvestigacion | null = null;
  let errorBusqueda: string | null = null;
  // Issue #147 — bug real: cualquier error que no fuera uno de los 4
  // tipos de arriba (ej. un 401/403 real de Mercado Libre, la cuenta
  // desconectada, el candado de renovación, invalid_grant) se
  // relanzaba tal cual y, sin app/panel/investigacion/error.tsx,
  // Next.js mostraba "Application error" sin mensaje — justo lo que
  // reportó Mateo. Ahora se atrapan todos los tipos conocidos con un
  // mensaje en español claro; lo único que de verdad sigue subiendo
  // (a error.tsx) es un error que de verdad no se esperaba.
  let mostrarEnlaceReconectar = false;

  if (termino) {
    try {
      resultado = await buscarInvestigacionProducto(empresa.id, termino);
    } catch (error) {
      if (
        error instanceof TerminoInvalidoError ||
        error instanceof LimiteBusquedasError ||
        error instanceof SinCuentaMlError ||
        error instanceof LimiteMercadoLibreError ||
        error instanceof MlSinPermisoAppError ||
        error instanceof MlNoDisponibleError ||
        error instanceof MlRespuestaInesperadaError
      ) {
        errorBusqueda = error.message;
      } else if (error instanceof MlNoAutorizadoError || error instanceof CuentaDesconectadaError || error instanceof RenovacionTokenFallidaError) {
        errorBusqueda = error.message;
        mostrarEnlaceReconectar = true;
      } else if (error instanceof CuentaMlNoEncontradaError) {
        errorBusqueda = error.message;
      } else if (error instanceof CandadoDeRenovacionError) {
        errorBusqueda = error.message; // el mensaje ya incluye "reintentar en unos segundos" — no se duplica
      } else {
        throw error;
      }
    }
  }

  const qsTab = (destino: Tab) => `?termino=${encodeURIComponent(termino)}&tab=${destino}`;
  const pestanas: Pestana[] = [
    { etiqueta: "Demanda", href: qsTab("demanda"), activa: tab === "demanda" },
    { etiqueta: "Mercado", href: qsTab("mercado"), activa: tab === "mercado" },
    { etiqueta: "Estrategia", href: qsTab("estrategia"), activa: tab === "estrategia" },
  ];

  const hayResultado = Boolean(resultado && !resultado.aviso);

  return (
    <>
      <EncabezadoPagina
        titulo="Investigación"
        descripcion="Analiza un producto o nicho con datos reales de Mercado Libre Colombia antes de invertir en él."
        accion={
          <BotonLink href="/panel/investigacion/seguimiento" variante="secundario" chico>
            Seguimiento diario
          </BotonLink>
        }
      />

      <Tarjeta className={styles.formulario}>
        <form method="get" className={styles.filaFormulario}>
          <Campo etiqueta="Producto o nicho (hasta 3 palabras)">
            <input type="search" name="termino" defaultValue={termino} placeholder='Ej: "reloj digital"' className="zx-control" required />
          </Campo>
          <input type="hidden" name="tab" value={tab} />
          <Boton type="submit">Analizar</Boton>
        </form>
        <p className={styles.ayuda}>
          Solo Mercado Libre Colombia por API. Amazon, Temu, AliExpress, Shein y Alibaba: solo con la extensión de Zilonix instalada y la página de
          ese producto ya abierta — todavía no se buscan desde aquí.
        </p>
      </Tarjeta>

      {errorBusqueda ? (
        <EstadoVacio>
          {errorBusqueda}
          {mostrarEnlaceReconectar ? (
            <>
              {" "}
              <BotonLink href="/panel/conectar-ml" variante="secundario" chico>
                Reconectar cuenta
              </BotonLink>
            </>
          ) : null}
        </EstadoVacio>
      ) : null}

      {!termino && !errorBusqueda ? (
        <EstadoVacio>Escribe un producto o nicho para analizar demanda, competencia y oportunidades.</EstadoVacio>
      ) : null}

      {resultado && resultado.aviso ? <EstadoVacio>{resultado.aviso}</EstadoVacio> : null}

      {hayResultado && resultado ? (
        <div className={styles.resultado}>
          <Pestanas pestanas={pestanas} />

          <p className={styles.alcance}>
            Publicaciones de catálogo con oferta activa encontradas para &quot;{resultado.termino}&quot; — no es el total de publicaciones del
            mercado (esa cifra no la expone la API oficial de Mercado Libre a esta aplicación).
          </p>

          {tab === "demanda" ? (
            <>
              <div className={styles.insignia}>
                <InsigniaExtension />
                <span className={styles.notaInsignia}>
                  Con la extensión podés abrir cada candidato en Mercado Libre para ver datos reales actualizados al momento, y analizar Amazon,
                  Temu y otras plataformas.
                </span>
              </div>

              <div className={styles.kpis}>
                <TarjetaKpi
                  titulo="VENDIDOS TOTALES (REAL)"
                  valor={resultado.vendidosTotalesReales ?? undefined}
                  detalle={[`${resultado.publicacionesConVendidosReal} de ${resultado.publicacionesEncontradas} publicaciones con dato real`]}
                />
                <TarjetaKpi titulo="PROM. VENDIDOS POR PUBLICACIÓN" valor={resultado.promedioVendidosPorPublicacion ?? undefined} />
                <TarjetaKpi
                  titulo="FACTURACIÓN EST. COP / MES"
                  valor={resultado.facturacionMesTotalEstimada != null ? money(resultado.facturacionMesTotalEstimada) : undefined}
                  detalle={resultado.facturacionMesTotalEstimada != null ? ["Estimado (estilo Selltrix) — nunca confirmado por Mercado Libre"] : undefined}
                />
              </div>

              <div>
                <p className={styles.tituloSeccion}>
                  Publicaciones encontradas (hasta 10 — ordenadas por vendidos real cuando hay dato, nunca por precio disfrazado de popularidad)
                </p>
                <Tabla encabezados={["Foto", "Producto", "Vendidos", "Precio", "Fact. est. COP/mes", "Catálogo", "Full", "Vendedor", "Enlace", ""]}>
                  {resultado.publicaciones.map((p) => (
                    <FilaTabla key={p.itemId}>
                      <CeldaTabla>
                        {/* app no usa next/image a propósito (mismo criterio que BarraSuperior/BarraLateral) — foto de Mercado Libre, dominio ajeno. */}
                        {p.foto ? <img src={p.foto} alt="" width={36} height={36} className={styles.foto} /> : "—"}
                      </CeldaTabla>
                      <CeldaTabla>{p.titulo}</CeldaTabla>
                      <CeldaTabla>
                        {p.vendidos != null ? (
                          <>
                            {numero(p.vendidos)}
                            {p.ventasMesEstimadas != null ? (
                              <div className={styles.subdato}>~{numero(p.ventasMesEstimadas)}/mes (estimado)</div>
                            ) : null}
                          </>
                        ) : (
                          <Chip>Sin dato</Chip>
                        )}
                      </CeldaTabla>
                      <CeldaTabla>{money(p.precio)}</CeldaTabla>
                      <CeldaTabla>{p.facturacionMesEstimada != null ? money(p.facturacionMesEstimada) : "—"}</CeldaTabla>
                      <CeldaTabla>{p.productId != null ? <Chip estado="exito">Sí</Chip> : <Chip>No</Chip>}</CeldaTabla>
                      <CeldaTabla>{p.esFull ? <Chip estado="exito">Full</Chip> : <Chip>—</Chip>}</CeldaTabla>
                      <CeldaTabla>{p.vendedor ?? "—"}</CeldaTabla>
                      <CeldaTabla>
                        {p.link ? (
                          <a href={p.link} target="_blank" rel="noreferrer">
                            Ver en Mercado Libre
                          </a>
                        ) : (
                          "—"
                        )}
                      </CeldaTabla>
                      <CeldaTabla>
                        <Link href={`/panel/investigacion/seguimiento?agregar=${encodeURIComponent(p.itemId)}`} className={styles.enlaceSeguir}>
                          Seguir
                        </Link>
                      </CeldaTabla>
                    </FilaTabla>
                  ))}
                </Tabla>
              </div>
            </>
          ) : null}

          {tab === "mercado" ? (
            <div className={styles.kpis}>
              <TarjetaKpi titulo="PUBLICACIONES ENCONTRADAS" valor={resultado.publicacionesEncontradas} />
              <TarjetaKpi titulo="VENDEDORES DISTINTOS" valor={resultado.vendedoresDistintos} />
              <TarjetaKpi titulo="PRECIO MÍNIMO" valor={resultado.precioMinimo != null ? money(resultado.precioMinimo) : undefined} />
              <TarjetaKpi titulo="PRECIO PROMEDIO (TICKET)" valor={resultado.precioPromedio != null ? money(resultado.precioPromedio) : undefined} />
              <TarjetaKpi titulo="PRECIO MÁXIMO" valor={resultado.precioMaximo != null ? money(resultado.precioMaximo) : undefined} />
              <TarjetaKpi titulo="% FULL" valor={resultado.porcentajeFull != null ? `${resultado.porcentajeFull}%` : undefined} />
              <TarjetaKpi titulo="% ENVÍO GRATIS" valor={resultado.porcentajeEnvioGratis != null ? `${resultado.porcentajeEnvioGratis}%` : undefined} />
            </div>
          ) : null}

          {tab === "estrategia" ? (
            <>
              <Tarjeta>
                <p className={styles.tituloSeccion}>Veredicto</p>
                {resultado.veredicto ? <p className={styles.veredicto}>{resultado.veredicto}</p> : <EstadoVacio>Sin suficientes datos todavía para un veredicto.</EstadoVacio>}
              </Tarjeta>

              <Tarjeta>
                <p className={styles.tituloSeccion}>Plan de ataque</p>
                {resultado.estrategiaSugerida.length ? (
                  <ul className={styles.listaEstrategia}>
                    {resultado.estrategiaSugerida.map((regla, i) => (
                      <li key={i}>{regla.texto}</li>
                    ))}
                  </ul>
                ) : (
                  <EstadoVacio>No hay suficientes datos reales todavía para sugerir un plan.</EstadoVacio>
                )}
              </Tarjeta>
            </>
          ) : null}
        </div>
      ) : null}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
