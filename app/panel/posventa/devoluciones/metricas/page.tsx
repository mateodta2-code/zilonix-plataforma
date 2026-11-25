import { and, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos } from "@/db/schema";
import { GraficaLineas } from "@/components/marco/GraficaLineas";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { cargarDevolucionesEmpresa, enriquecerParaMetricas } from "@/lib/ml/devoluciones";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { datosSitioMl, formatearMonedaIso, formatearNumero } from "@/lib/ml/sitios";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { avisoTope, calcularMetricas, desdePeriodoMs, leerPeriodoDias, PERIODOS_DIAS, porcentajeSobreVentas, serieSemanal } from "@/lib/posventa/metricasDevoluciones";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "../Devoluciones.module.css";

// Posventa-Devoluciones (Refs #648) — métricas en vivo, solo lectura. No
// guarda historial (sería una migración: siguiente paso). Las ventas del
// periodo salen de los pedidos importados a Zilonix, con RLS de la empresa.

type Params = { cuenta?: string | string[]; dias?: string | string[] };

export default async function MetricasDevolucionesPage({ searchParams }: { searchParams?: Params }) {
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
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />;
  }

  const dias = leerPeriodoDias(searchParams?.dias);
  const ahoraMs = Date.now();
  const desdeMs = desdePeriodoMs(dias, ahoraMs);
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, searchParams?.cuenta);

  const carga = await cargarDevolucionesEmpresa(empresa.id, { cuentaId, desdeMs });
  const filasMetrica = await enriquecerParaMetricas(empresa.id, carga.filas);
  const resumen = calcularMetricas(filasMetrica);

  const ventasPorCuenta = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ cuentaMlId: pedidos.cuentaMlId, ventas: sql<number>`count(*)::int` })
      .from(pedidos)
      .where(and(eq(pedidos.empresaId, empresa.id), gte(pedidos.fecha, new Date(desdeMs)), ...(cuentaId ? [eq(pedidos.cuentaMlId, cuentaId)] : [])))
      .groupBy(pedidos.cuentaMlId)
  );
  const ventas = ventasPorCuenta.reduce((s, v) => s + v.ventas, 0);
  const pct = porcentajeSobreVentas(resumen.cantidad, ventas);

  const sitio = datosSitioMl(carga.filas[0]?.siteId);
  const numero = (n: number) => formatearNumero(n, sitio.idioma);
  const porcentaje = (p: number | null) => (p === null ? "—" : `${formatearNumero(Math.round(p * 10) / 10, sitio.idioma)} %`);
  const aviso = avisoTope(carga.filas.length, carga.truncado);
  const serie = serieSemanal(carga.filas.map((f) => f.reclamo.fecha), desdeMs, ahoraMs);

  return (
    <>
      <p className={styles.migas}>
        <Link href="/panel/posventa/devoluciones">← Devoluciones</Link>
      </p>
      <div className={styles.barra}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={searchParams?.cuenta} parametros={{ dias: String(dias) }} />
        {PERIODOS_DIAS.map((d) => (
          <Link key={d} href={`/panel/posventa/devoluciones/metricas?dias=${d}${cuentaId ? `&cuenta=${cuentaId}` : ""}`} className={styles.tarjetaEstado} data-activa={d === dias}>
            <span className={styles.tarjetaTexto}>Últimos {d} días</span>
          </Link>
        ))}
      </div>

      {carga.cuentasSinRevisar.length > 0 && (
        <div className={styles.aviso}>
          No se pudieron revisar: {carga.cuentasSinRevisar.map((c) => `${c.nickname} (${c.motivo})`).join("; ")}
        </div>
      )}
      {aviso && <div className={styles.aviso}>{aviso}</div>}

      <RejillaKpi>
        <TarjetaKpi titulo="Devoluciones" valor={numero(resumen.cantidad)} />
        <TarjetaKpi titulo="% sobre ventas" valor={porcentaje(pct)} detalle={[`${numero(ventas)} ventas importadas en el periodo`]} />
        <TarjetaKpi
          titulo="Costo de envíos de vuelta"
          valor={resumen.costos.length === 0 ? "—" : resumen.costos.map((c) => formatearMonedaIso(c.total, c.moneda)).join(" · ")}
        />
        <TarjetaKpi titulo="Cuentas con devoluciones" valor={numero(resumen.porCuenta.length)} />
      </RejillaKpi>

      <Tarjeta>
        <GraficaLineas
          titulo="Devoluciones por semana"
          puntos={serie.map((s, i) => ({
            etiqueta: `S${i + 1}`,
            valor: s.cantidad,
            etiquetaLarga: `Semana del ${formatearFechaPedido(new Date(s.inicioMs), sitio.moneda)}`,
          }))}
          formatoValor={numero}
          nombreValor="Devoluciones"
        />
      </Tarjeta>

      <div className={styles.dosColumnas}>
        <Tarjeta>
          <div className={styles.seccion}>
            <p className={styles.seccionTitulo}>Motivos más comunes</p>
            <ul className={styles.ranking}>
              {resumen.motivos.length === 0 && <li className={styles.texto}>Sin datos en el periodo.</li>}
              {resumen.motivos.map((m) => (
                <li key={m.motivoId ?? "sin-motivo"} className={styles.rankingFila}>
                  <span>{m.texto ?? m.motivoId ?? "Sin motivo"}</span>
                  <strong>{numero(m.cantidad)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </Tarjeta>
        <Tarjeta>
          <div className={styles.seccion}>
            <p className={styles.seccionTitulo}>Por producto</p>
            <ul className={styles.ranking}>
              {resumen.porProducto.length === 0 && <li className={styles.texto}>Sin datos en el periodo.</li>}
              {resumen.porProducto.map((p) => (
                <li key={p.clave} className={styles.rankingFila}>
                  <span>{p.titulo ?? p.clave}</span>
                  <strong>{numero(p.cantidad)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </Tarjeta>
        <Tarjeta>
          <div className={styles.seccion}>
            <p className={styles.seccionTitulo}>Por cuenta</p>
            <ul className={styles.ranking}>
              {resumen.porCuenta.length === 0 && <li className={styles.texto}>Sin datos en el periodo.</li>}
              {resumen.porCuenta.map((c) => {
                const ventasCuenta = ventasPorCuenta.find((v) => v.cuentaMlId === c.clave)?.ventas ?? 0;
                return (
                  <li key={c.clave} className={styles.rankingFila}>
                    <span>{c.titulo}</span>
                    <strong>
                      {numero(c.cantidad)} ({porcentaje(porcentajeSobreVentas(c.cantidad, ventasCuenta))})
                    </strong>
                  </li>
                );
              })}
            </ul>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}
