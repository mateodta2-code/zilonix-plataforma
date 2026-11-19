import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { GraficaLineas } from "@/components/marco/GraficaLineas";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { cloudinaryConfigurado } from "@/lib/cloudinary";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerConexionIA } from "@/lib/ia/conexion";
import { proveedorGeneraImagenes } from "@/lib/ia/imagen";
import { obtenerMiMembresia } from "@/lib/membresias";
import { competenciaItemMl, leerItemEdicionMl, PATRON_ID_PRODUCTO_O_ITEM, tieneAutomatizacionPrecioMl } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { linkPublicacion } from "@/lib/ml/permalink";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { formatearMoneda } from "@/lib/ml/sitios";
import { costoFijoPorUnidad, diasInventario, porUnidad, precioMinimo, resumirPeriodo, serieDiaria, utilidadAcumulada, variacion, type ResumenPeriodo } from "@/lib/optimizacion/calculos";
import { leerDatosDetalle, type DatosDetalle } from "@/lib/optimizacion/detalle";
import { opcionesPeriodo, resolverPeriodoDetalle } from "@/lib/optimizacion/periodo";
import { rotuloTipoPublicacion } from "@/lib/optimizacion/textos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { restarDiasIso } from "@/lib/publicidad/plan";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "../page.module.css";
import { EditarPublicacion, type DatosEdicion } from "./EditarPublicacion";

// Optimización, Fase 2 — detalle de una publicación. Ver pide
// inventario/consultar; los costos, la ganancia y el precio mínimo,
// además, finanzas/consultar (decisión de Santiago, 17-nov).

type ParametroUrl = string | string[] | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

export default async function DetalleOptimizacionPage({
  params,
  searchParams,
}: {
  params: { itemId: string };
  searchParams?: { cuenta?: ParametroUrl; periodo?: ParametroUrl; costos?: ParametroUrl };
}) {
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
    return (
      <>
        <EncabezadoPagina titulo="Optimización" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const itemId = typeof params.itemId === "string" ? params.itemId.toUpperCase() : "";
  const cuentaId = primero(searchParams?.cuenta) ?? "";
  const ahora = new Date();
  const periodo = resolverPeriodoDetalle(primero(searchParams?.periodo), ahora);
  const porUnidadModo = primero(searchParams?.costos) === "unidad";
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const conFinanzas = miMembresia ? tienePermiso(miMembresia.permisos, "finanzas", "consultar") : false;
  const puedeEditar = miMembresia ? tienePermiso(miMembresia.permisos, "inventario", "modificar") : false;
  const volver = <BotonLink href={`/panel/optimizacion${UUID.test(cuentaId) ? `?cuenta=${cuentaId}` : ""}`} chico>← Volver a la lista</BotonLink>;

  const cuenta =
    PATRON_ID_PRODUCTO_O_ITEM.test(itemId) && UUID.test(cuentaId)
      ? (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId && !c.desconectadaTs)
      : undefined;
  if (!cuenta) {
    return (
      <>
        <EncabezadoPagina titulo="Optimización" accion={volver} />
        <EstadoVacio>No se encontró esa publicación en una cuenta conectada de esta empresa.</EstadoVacio>
      </>
    );
  }

  let datos: DatosDetalle | null = null;
  let aviso: string | null = null;
  try {
    datos = await leerDatosDetalle(empresa.id, cuenta, itemId, periodo, { conFinanzas, ahora });
  } catch (error) {
    console.warn(`[app/panel/optimizacion] detalle ${itemId}: ${error instanceof Error ? error.name : "error"}`);
    aviso = motivoCuentaSinRevisar(error);
  }
  if (!datos) {
    return (
      <>
        <EncabezadoPagina titulo="Optimización" accion={volver} />
        <EstadoVacio>{aviso ?? "Mercado Libre no devolvió esa publicación. Puede que ya no exista."}</EstadoVacio>
      </>
    );
  }

  const siteId = cuenta.siteId;
  const idioma = cuenta.idioma;
  const plata = (v: string | null) => (v === null ? "—" : formatearMoneda(Number(v), siteId));
  const pct = (v: string | null) => (v === null ? "—" : `${Number(v).toLocaleString(idioma, { maximumFractionDigits: 1 })} %`);
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString(idioma));
  // "2026-11-18" -> "mar, 18 nov". Mediodía UTC para que ninguna zona
  // horaria lo corra al día anterior.
  const diaLargo = (dia: string) =>
    new Date(`${dia}T12:00:00Z`).toLocaleDateString(idioma, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const cambio = (v: string | null) =>
    v === null ? undefined : { texto: `${Number(v) > 0 ? "+" : ""}${Number(v).toLocaleString(idioma, { maximumFractionDigits: 1 })} % vs. período anterior`, mejor: Number(v) === 0 ? null : Number(v) > 0 };

  const base = { lineas: datos.lineas, publicidad: datos.publicidad, visitasPorDia: datos.visitasPorDia, conFinanzas };
  const actual: ResumenPeriodo = resumirPeriodo({ ...base, desde: periodo.desde, hasta: periodo.hasta, visitasCompletas: periodo.desde >= datos.visitasDesde });
  const anterior: ResumenPeriodo = resumirPeriodo({
    ...base,
    desde: periodo.anteriorDesde,
    hasta: periodo.anteriorHasta,
    visitasCompletas: periodo.anteriorDesde >= datos.visitasDesde,
  });
  const dias: string[] = [];
  for (let d = periodo.desde; d <= periodo.hasta; d = restarDiasIso(d, -1)) dias.push(d);
  const serie = serieDiaria(datos.lineas, datos.visitasPorDia, dias);
  const enCostos = (v: string | null) => (porUnidadModo ? porUnidad(v, actual.unidades) : v);
  const minimo = precioMinimo(actual);
  const diasStock = diasInventario(datos.item.stock, actual.unidades, periodo.dias);
  const historia = utilidadAcumulada(datos.lineas, datos.publicidad, conFinanzas);
  // Fase 3 — edición: datos frescos de ML (ventas, variantes, fotos,
  // automatización y precio para ganar) y la base del simulador con los
  // costos del período elegido. Solo para quien puede modificar.
  let edicion: DatosEdicion | null = null;
  if (puedeEditar) {
    try {
      const token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
      const [itemEdicion, automatizada, competencia, conexionIA] = await Promise.all([
        leerItemEdicionMl(datos.item.id, token),
        tieneAutomatizacionPrecioMl(datos.item.id, token),
        datos.item.catalogo ? competenciaItemMl(datos.item.id, token, siteId).catch(() => null) : Promise.resolve(null),
        obtenerConexionIA(empresa.id, "optimizacion").catch(() => null),
      ]);
      // Sin permiso de Finanzas el simulador no muestra ganancia.
      const c = conFinanzas ? actual.costos : null;
      if (itemEdicion) {
        edicion = {
          itemId: itemEdicion.id,
          cuentaMlId: cuenta.id,
          siteId,
          idioma,
          precio: itemEdicion.precio,
          titulo: itemEdicion.titulo,
          vendidas: itemEdicion.vendidas,
          tieneVariantes: itemEdicion.tieneVariantes,
          automatizada,
          fotos: itemEdicion.fotos,
          cloudinaryConfigurado: cloudinaryConfigurado(),
          iaImagen: !conexionIA ? "sin_conexion" : proveedorGeneraImagenes(conexionIA.proveedor) ? "lista" : "sin_imagenes",
          base: {
            fijoPorUnidad: c ? costoFijoPorUnidad(actual) : null,
            comision: c ? c.comision : null,
            ventas: c ? actual.ventasConcretadas : null,
            precioParaGanar: typeof competencia?.precioParaGanar === "number" ? competencia.precioParaGanar.toFixed(2) : null,
          },
        };
      }
    } catch (error) {
      console.warn(`[app/panel/optimizacion] edición ${itemId}: ${error instanceof Error ? error.name : "error"}`);
    }
  }

  const href = (cambios: { periodo?: string; costos?: string }) => {
    const q = new URLSearchParams({ cuenta: cuenta.id, periodo: cambios.periodo ?? periodo.clave });
    const costos = cambios.costos ?? (porUnidadModo ? "unidad" : "total");
    if (costos === "unidad") q.set("costos", "unidad");
    return `/panel/optimizacion/${datos!.item.id}?${q.toString()}`;
  };

  return (
    <>
      <EncabezadoPagina
        titulo={datos.item.titulo ?? datos.item.id}
        descripcion={[datos.item.id, datos.item.sku ? `SKU ${datos.item.sku}` : "Sin SKU", cuenta.nickname, rotuloTipoPublicacion(datos.item.tipoPublicacion)].join(" · ")}
        accion={volver}
      />

      <div className={styles.panelDatos}>
        {linkPublicacion(datos.item.id) ? (
          <a href={linkPublicacion(datos.item.id)!} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
            Ver publicación en Mercado Libre ↗
          </a>
        ) : null}
        <span className={styles.filtro} aria-label="Período">
          {opcionesPeriodo(ahora).map((o) => (
            <Link key={o.clave} scroll={false} href={href({ periodo: o.clave })} aria-current={o.clave === periodo.clave ? "page" : undefined}>
              {o.rotulo}
            </Link>
          ))}
        </span>
        <p className={styles.nota}>{`Del ${periodo.desde} al ${periodo.hasta}, comparado con el ${periodo.anteriorDesde} al ${periodo.anteriorHasta}.`}</p>
      </div>

      <RejillaKpi>
        <TarjetaKpi titulo="Ventas brutas" valor={plata(actual.ventasBrutas)} variacion={cambio(variacion(actual.ventasBrutas, anterior.ventasBrutas))} detalle={["Incluye canceladas."]} />
        <TarjetaKpi titulo="Ventas concretadas" valor={plata(actual.ventasConcretadas)} variacion={cambio(variacion(actual.ventasConcretadas, anterior.ventasConcretadas))} detalle={[`${num(actual.pedidos)} ventas`]} />
        <TarjetaKpi titulo="Unidades" valor={num(actual.unidades)} variacion={cambio(variacion(actual.unidades, anterior.unidades))} />
        <TarjetaKpi titulo="Precio promedio" valor={plata(actual.precioPromedio)} variacion={cambio(variacion(actual.precioPromedio, anterior.precioPromedio))} />
        <TarjetaKpi titulo="Visitas" valor={num(actual.visitas)} variacion={cambio(variacion(actual.visitas, anterior.visitas))} />
        <TarjetaKpi titulo="Compradores únicos" valor="—" detalle={["Seller no guarda quién compró."]} />
        <TarjetaKpi titulo="Conversión" valor={pct(actual.conversion)} variacion={cambio(variacion(actual.conversion, anterior.conversion))} detalle={["Ventas ÷ visitas."]} />
      </RejillaKpi>

      <Tarjeta className={styles.tarjeta}>
        <p className={styles.seccion}>Por día</p>
        {/* Al pasar el mouse: el día, su valor y el de la otra gráfica. */}
        <GraficaLineas
          titulo="Unidades vendidas"
          nombreValor="Unidades vendidas"
          puntos={serie.map((p) => ({
            etiqueta: p.dia.slice(5),
            etiquetaLarga: diaLargo(p.dia),
            valor: p.ventas,
            extra: [`Visitas: ${p.dia >= datos!.visitasDesde && p.visitas !== null ? num(p.visitas) : "—"}`],
          }))}
          formatoValor={(n) => n.toLocaleString(idioma)}
        />
        <GraficaLineas
          titulo="Visitas"
          nombreValor="Visitas"
          puntos={serie.map((p) => ({
            etiqueta: p.dia.slice(5),
            etiquetaLarga: diaLargo(p.dia),
            valor: p.dia >= datos!.visitasDesde ? p.visitas : null,
            extra: [`Unidades vendidas: ${num(p.ventas)}`],
          }))}
          formatoValor={(n) => n.toLocaleString(idioma)}
        />
        {periodo.anteriorDesde < datos.visitasDesde ? (
          <p className={styles.nota}>{`Mercado Libre entrega visitas solo desde el ${datos.visitasDesde}: lo anterior sale "—".`}</p>
        ) : null}
      </Tarjeta>

      {edicion ? (
        <Tarjeta className={styles.tarjeta}>
          <p className={styles.seccion}>Editar en Mercado Libre</p>
          <EditarPublicacion datos={edicion} />
        </Tarjeta>
      ) : null}

      {conFinanzas ? (
        <>
          <Tarjeta className={styles.tarjeta}>
            <div className={styles.barra}>
              <p className={styles.seccion}>Costos</p>
              <span className={styles.filtro}>
                <Link scroll={false} href={href({ costos: "total" })} aria-current={!porUnidadModo ? "page" : undefined}>
                  Total
                </Link>
                <Link scroll={false} href={href({ costos: "unidad" })} aria-current={porUnidadModo ? "page" : undefined}>
                  Por unidad
                </Link>
              </span>
            </div>
            {actual.costos === null ? (
              <p className={styles.nota}>Faltan ventas por sincronizar en Finanzas: los costos de este período no están completos.</p>
            ) : (
              <Tabla encabezados={["Concepto", { clave: "valor", contenido: porUnidadModo ? "Por unidad" : "Total", numerica: true }]}>
                <FilaTabla>
                  <CeldaTabla>Ventas</CeldaTabla>
                  <CeldaTabla numerica>{plata(enCostos(actual.ventasConcretadas))}</CeldaTabla>
                </FilaTabla>
                {[
                  ["Comisión de Mercado Libre", enCostos(actual.costos.comision)],
                  ["Envío", enCostos(actual.costos.envio)],
                  ["Publicidad", enCostos(actual.inversion)],
                  ["Costo del producto", enCostos(actual.costos.costoProducto)],
                  ["Empaque", enCostos(actual.costos.empaque)],
                ].map(([concepto, valor]) => (
                  <FilaTabla key={concepto}>
                    <CeldaTabla>{concepto}</CeldaTabla>
                    <CeldaTabla numerica>{plata(valor)}</CeldaTabla>
                  </FilaTabla>
                ))}
                <FilaTabla>
                  <CeldaTabla>Impuestos y retenciones</CeldaTabla>
                  <CeldaTabla numerica>
                    <span className={styles.notaNeutra}>Próximamente</span>
                  </CeldaTabla>
                </FilaTabla>
                {/* Ventas − todo lo de arriba (sin impuestos todavía). */}
                <FilaTabla className={styles.filaUtilidad}>
                  <CeldaTabla>
                    <strong>Utilidad</strong>
                    {actual.margen !== null ? <span className={styles.notaNeutra}>{` · ${pct(actual.margen)} de lo vendido`}</span> : null}
                  </CeldaTabla>
                  <CeldaTabla numerica>
                    {actual.ganancia === null ? (
                      <span className={styles.notaNeutra}>Falta algún costo</span>
                    ) : (
                      <strong className={Number(actual.ganancia) < 0 ? styles.negativo : styles.positivo}>{plata(enCostos(actual.ganancia))}</strong>
                    )}
                  </CeldaTabla>
                </FilaTabla>
              </Tabla>
            )}
          </Tarjeta>

          <Tarjeta className={styles.tarjeta}>
            <p className={styles.seccion}>Lo que Mercado Libre no te muestra</p>
            <RejillaKpi>
              <TarjetaKpi
                titulo="Ganancia real por unidad"
                valor={plata(porUnidad(actual.ganancia, actual.unidades))}
                detalle={[actual.margen === null ? "Falta algún costo." : `${pct(actual.margen)} de lo vendido · ${plata(actual.ganancia)} en el período`, "Después de comisión, envío, publicidad, costo y empaque. Sin impuestos todavía."]}
              />
              <TarjetaKpi
                titulo="Utilidad total de la publicación"
                valor={plata(historia.ganancia)}
                detalle={[
                  historia.pedidos === 0
                    ? "Seller todavía no tiene ventas de esta publicación."
                    : `${num(historia.unidades)} ${historia.unidades === 1 ? "unidad" : "unidades"} en ${num(historia.pedidos)} ${historia.pedidos === 1 ? "venta" : "ventas"} desde el ${historia.primerDia}${historia.margen !== null ? ` · ${pct(historia.margen)} de lo vendido` : ""}.`,
                  historia.pedidosSinCosto > 0
                    ? `${num(historia.pedidosSinCosto)} ${historia.pedidosSinCosto === 1 ? "venta no suma" : "ventas no suman"}: falta sincronizarlas en Finanzas o el costo del producto.`
                    : "Todo lo vendido, menos comisión, envío, publicidad, costo y empaque.",
                ]}
              />
              <TarjetaKpi titulo="Precio mínimo para no perder" valor={plata(minimo)} detalle={["Aproximado, con los costos de este período."]} />
              <TarjetaKpi titulo="ACOS" valor={pct(actual.acos)} detalle={["Publicidad ÷ ventas por publicidad."]} />
              <TarjetaKpi titulo="TACOS" valor={pct(actual.tacos)} detalle={["Publicidad ÷ ventas totales."]} />
              <TarjetaKpi
                titulo="Días de inventario"
                valor={diasStock === null ? "—" : num(diasStock)}
                detalle={[diasStock === null ? "Sin ventas en el período." : `Te quedas sin stock en ${num(diasStock)} días (stock ${num(datos.item.stock)}).`]}
              />
            </RejillaKpi>
          </Tarjeta>
        </>
      ) : (
        <Tarjeta className={styles.tarjeta}>
          <p className={styles.nota}>Los costos, la ganancia real y el precio mínimo los ven quienes tienen permiso de Finanzas.</p>
          <p className={styles.nota}>{`Días de inventario: ${diasStock === null ? "— (sin ventas en el período)" : `te quedas sin stock en ${num(diasStock)} días`}.`}</p>
        </Tarjeta>
      )}
    </>
  );
}
