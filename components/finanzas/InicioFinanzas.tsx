import { mostrarPorcentaje } from "@/components/finanzas/formato";
import type { Indicadores } from "@/lib/finanzas/indicadores";
import { avanceMeta } from "@/lib/finanzas/meta-avance";
import type { MetaDelMes } from "@/lib/finanzas/meta-mes";
import { textoVariacion, type TableroMes } from "@/lib/finanzas/tablero";
import { formatearMonto } from "@/lib/panel-kpis";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { fijarMetaAction } from "@/app/panel/meta/actions";
import { Comparativo, InversionPublicidad, Participacion } from "./GraficasCuenta";
import { plural } from "./textosTablero";
import styles from "./inicio.module.css";

// Inicio (Sharel y el equipo, 13-nov) — tres partes, solo con
// finanzas.consultar (app/panel/page.tsx no monta esto sin ese permiso):
// 1. Hoy: los indicadores del día de Bogotá.
// 2. Meta del mes: avance de la utilidad DESPUÉS de publicidad contra la
//    meta que fija el Dueño (#125/#126), bien explicado.
// 3. Período: los mismos indicadores para el mes en curso o el rango del
//    filtro (hasta 31 días), con las gráficas por cuenta y la operación.
// Solo pinta: todo se lee en app/panel/page.tsx.

type Props = {
  hoy: Indicadores;
  periodo: Indicadores;
  // Los indicadores del mes en curso (día 1 a hoy), para la meta.
  mes: Indicadores;
  // El tablero del mes (variación vs. mismo tramo del mes anterior):
  // solo cuando el período es el mes en curso.
  tablero: TableroMes | null;
  meta: MetaDelMes;
  puedeFijarMeta: boolean;
  filtro: { desde: string; hasta: string; esMesActual: boolean; error: string | null };
  avisoMeta: { tipo: "ok" | "error"; texto: string } | null;
  // Tarjetas de operación (pedidos, despachos, SKU), según permisos.
  operacion: React.ReactNode;
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function nombreMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}

function monedaDe(ind: Indicadores): string {
  return ind.recaudo[0]?.moneda ?? "COP";
}

function plata(moneda: string, monto: string | null): string {
  return monto === null ? "—" : `${moneda} ${formatearMonto(monto)}`;
}

function recaudoTexto(ind: Indicadores): string {
  if (ind.recaudo.length === 0) return "COP 0";
  return ind.recaudo.map((r) => plata(r.moneda, r.monto)).join(" · ");
}

function ticketTexto(ind: Indicadores): string {
  if (ind.recaudo.length === 0) return "—";
  return ind.recaudo.map((r) => plata(r.moneda, r.ticketPromedio)).join(" · ");
}

function avisoSinSincronizar(ind: Indicadores): string[] {
  return ind.sinSincronizar > 0
    ? [`${plural(ind.sinSincronizar, "venta", "ventas")} sin sincronizar no entran en plata · usa «Traer ventas de este mes» en Finanzas → Ventas`]
    : [];
}

function detalleUtilidad(ind: Indicadores): string[] {
  const u = ind.utilidad;
  return [
    "Ventas con costo: recaudo − comisión ML − flete ML − costo − packing − envío.",
    ...(u.ventasSinCosto > 0 ? [`${plural(u.ventasSinCosto, "venta", "ventas")} sin costo no entran (${plata(monedaDe(ind), u.recaudoSinCosto)})`] : []),
    ...(u.variasMonedas ? ["Hay ventas en varias monedas: la utilidad por moneda llega después"] : []),
    ...(!u.variasMonedas && u.utilidad === null && u.ventas > 0 ? ["Ninguna venta tiene costo cargado"] : []),
  ];
}

function textoPublicidad(ind: Indicadores): { valor: string; detalle: string[] } {
  const p = ind.publicidad;
  if (p.costo === null) return { valor: "Sin datos", detalle: ["No hay publicidad sincronizada en este período: se resta $0."] };
  return {
    valor: plata("COP", p.descontado),
    detalle: [
      p.iva === null
        ? `Costo de Product Ads ${plata("COP", p.costo)} · sin IVA configurado`
        : `Costo ${plata("COP", p.costo)} + IVA ${p.iva.replace(".", ",").replace(/,00$/, "")} %`,
    ],
  };
}

// Las tarjetas de una sección. `completo` agrega publicidad y utilidad
// después de publicidad (el período); en «Hoy» van las básicas.
function Tarjetas({ ind, completo, tablero }: { ind: Indicadores; completo: boolean; tablero: TableroMes | null }) {
  const moneda = monedaDe(ind);
  const pub = textoPublicidad(ind);
  const varRecaudo = tablero ? tablero.recaudo.map((r) => textoVariacion(r.variacion, tablero.sinSincronizar.anterior > 0)) : [];
  return (
    <div className={completo ? styles.gridKpi4 : styles.gridKpi}>
      <TarjetaKpi
        titulo="Número de ventas"
        valor={String(ind.ventas)}
        detalle={[...(tablero ? [textoVariacion(tablero.ventas.variacion)] : []), ...avisoSinSincronizar(ind)]}
      />
      <TarjetaKpi titulo="Recaudo" valor={recaudoTexto(ind)} detalle={[...varRecaudo, "Lo que pagó el cliente en las ventas sincronizadas."]} />
      <TarjetaKpi
        titulo="Ticket promedio"
        valor={ticketTexto(ind)}
        detalle={[`Recaudo ÷ ${plural(ind.recaudo.reduce((s, r) => s + r.ventasSincronizadas, 0), "venta sincronizada", "ventas sincronizadas")}.`]}
      />
      <TarjetaKpi titulo="Utilidad (antes de publicidad)" valor={plata(moneda, ind.utilidad.utilidad)} detalle={detalleUtilidad(ind)} />
      <TarjetaKpi
        titulo="Margen"
        valor={mostrarPorcentaje(ind.margen)}
        detalle={["Utilidad ÷ recaudo de las ventas con costo (antes de publicidad)."]}
      />
      {completo && <TarjetaKpi titulo="Publicidad" valor={pub.valor} detalle={pub.detalle} />}
      {completo && (
        <TarjetaKpi
          titulo="Utilidad después de publicidad"
          valor={plata(moneda, ind.utilidadDespues)}
          detalle={["Utilidad antes de publicidad − publicidad."]}
        />
      )}
      <TarjetaKpi
        titulo="Ventas por cuenta"
        valor={plural(ind.porCuenta.filter((c) => c.ventas > 0).length, "cuenta", "cuentas")}
        detalle={
          ind.porCuenta.filter((c) => c.ventas > 0).length === 0
            ? ["Sin ventas."]
            : ind.porCuenta
                .filter((c) => c.ventas > 0)
                .map((c) => `${c.nickname}: ${c.ventas} · ${c.recaudoPorMoneda.map((r) => plata(r.moneda, r.monto)).join(" · ") || "sin recaudo"}`)
        }
      />
    </div>
  );
}

function SeccionMeta({ meta, mes, puedeFijarMeta, avisoMeta }: Pick<Props, "meta" | "mes" | "puedeFijarMeta" | "avisoMeta">) {
  const a = meta.avance;
  const moneda = monedaDe(mes);
  const pub = textoPublicidad(mes);
  // Qué % de la meta sería la proyección al cierre (el mismo cálculo de
  // porcentaje de avanceMeta, con la proyección como «logrado»).
  const proyeccion = a && meta.meta ? avanceMeta({ meta: meta.meta, logrado: a.proyeccion, diasTranscurridos: 1, diasMes: 1 }).porcentaje : null;
  return (
    <Tarjeta className={styles.panel}>
      <div className={styles.metaEncabezado}>
        <h2 className={styles.titulo}>Meta del mes · {nombreMes(meta.mes)}</h2>
        <span className={styles.rango}>Utilidad después de publicidad, del 1 a hoy ({mes.tramo.hasta})</span>
      </div>
      {avisoMeta && <p className={avisoMeta.tipo === "ok" ? styles.avisoExito : styles.avisoError}>{avisoMeta.texto}</p>}

      {meta.meta === null ? (
        <p className={styles.metaVacia}>
          Sin meta para este mes.{" "}
          {puedeFijarMeta ? "Fíjala abajo para ver cuánto llevas y cuánto falta." : "Solo el Dueño de la empresa la puede fijar."}
        </p>
      ) : (
        <>
          <div className={styles.metaCifras}>
            <div>
              <span className={styles.metaEtiqueta}>Meta</span>
              <strong className={styles.metaValor}>{plata(moneda, meta.meta)}</strong>
            </div>
            <div>
              <span className={styles.metaEtiqueta}>Llevas</span>
              <strong className={styles.metaValor}>{plata(moneda, mes.utilidadDespues)}</strong>
            </div>
            <div>
              <span className={styles.metaEtiqueta}>Avance</span>
              <strong className={styles.metaValor}>{a ? mostrarPorcentaje(a.porcentaje) : "—"}</strong>
            </div>
          </div>
          <div
            className={styles.metaPista}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={a?.porcentajeBarra ?? 0}
            aria-label="Avance de la meta del mes"
          >
            <span className={styles.metaBarra} style={{ width: `${a?.porcentajeBarra ?? 0}%` }} />
          </div>

          {a === null ? (
            <p className={styles.ayuda}>
              No se puede calcular el avance: {mes.utilidad.variasMonedas ? "hay ventas en varias monedas." : "ninguna venta del mes tiene costo cargado."}
            </p>
          ) : (
            <ul className={styles.metaLineas}>
              <li>
                <span>Utilidad antes de publicidad</span>
                <span className={styles.numero}>{plata(moneda, mes.utilidad.utilidad)}</span>
              </li>
              <li>
                <span>− Publicidad {mes.publicidad.costo === null ? "(sin datos: $0)" : ""}</span>
                <span className={styles.numero}>{pub.valor === "Sin datos" ? plata(moneda, "0.00") : pub.valor}</span>
              </li>
              <li className={styles.metaTotal}>
                <span>= Utilidad después de publicidad</span>
                <span className={styles.numero}>{plata(moneda, mes.utilidadDespues)}</span>
              </li>
              <li>
                <span>{a.faltante === "0.00" ? "Meta cumplida 🎉" : "Falta para la meta"}</span>
                <span className={styles.numero}>{plata(moneda, a.faltante)}</span>
              </li>
              <li>
                <span>
                  Ritmo actual ({plural(a.diasTranscurridos, "día", "días")} transcurridos)
                </span>
                <span className={styles.numero}>{plata(moneda, a.ritmoActual)} / día</span>
              </li>
              {a.ritmoNecesario !== null && (
                <li>
                  <span>Necesitas en los {plural(a.diasRestantes, "día que queda", "días que quedan")}</span>
                  <span className={styles.numero}>{plata(moneda, a.ritmoNecesario)} / día</span>
                </li>
              )}
              <li>
                <span>Proyección al cierre (si sigues al ritmo actual)</span>
                <span className={styles.numero}>
                  {plata(moneda, a.proyeccion)}
                  {proyeccion !== null ? ` · ${mostrarPorcentaje(proyeccion)} de la meta` : ""}
                </span>
              </li>
            </ul>
          )}
          <p className={styles.ayuda}>
            La utilidad solo cuenta las ventas con costo cargado
            {mes.utilidad.ventasSinCosto > 0 ? ` (${plural(mes.utilidad.ventasSinCosto, "venta", "ventas")} sin costo no entran)` : ""}.{" "}
            {mes.publicidad.iva === null && mes.publicidad.costo !== null ? "La publicidad va sin IVA porque no está configurado." : ""}
          </p>
        </>
      )}

      {puedeFijarMeta && (
        <form action={fijarMetaAction} className={styles.metaForm}>
          <Campo etiqueta={meta.meta === null ? "Meta de utilidad del mes (COP)" : "Cambiar la meta del mes (COP)"}>
            <input
              name="meta"
              required
              inputMode="decimal"
              placeholder="20.000.000"
              defaultValue={meta.meta === null ? "" : formatearMonto(meta.meta)}
              className="zx-control"
            />
          </Campo>
          <Boton type="submit" variante="secundario" chico>
            Guardar meta
          </Boton>
        </form>
      )}
    </Tarjeta>
  );
}

export function InicioFinanzas(props: Props) {
  const { hoy, periodo, tablero, filtro, operacion } = props;
  return (
    <div className={styles.bloque}>
      <section aria-labelledby="titulo-hoy" className={styles.seccion}>
        <Tarjeta className={styles.encabezado}>
          <h2 id="titulo-hoy" className={styles.titulo}>
            Hoy <span className={styles.rango}>({hoy.tramo.desde}, día de Bogotá)</span>
          </h2>
          <p className={styles.ayuda}>Igual que en Finanzas · todas las cuentas de Mercado Libre de esta empresa.</p>
        </Tarjeta>
        <Tarjetas ind={hoy} completo={false} tablero={null} />
      </section>

      <SeccionMeta meta={props.meta} mes={props.mes} puedeFijarMeta={props.puedeFijarMeta} avisoMeta={props.avisoMeta} />

      <section aria-labelledby="titulo-periodo" className={styles.seccion}>
        <Tarjeta className={styles.encabezado}>
          <h2 id="titulo-periodo" className={styles.titulo}>
            {filtro.esMesActual ? "Mes en curso" : "Período elegido"}{" "}
            <span className={styles.rango}>
              ({periodo.tramo.desde} a {periodo.tramo.hasta} · {plural(periodo.tramo.dias, "día", "días")})
            </span>
          </h2>
          <form method="get" action="/panel" className={styles.filtro}>
            <Campo etiqueta="Desde">
              <input type="date" name="desde" defaultValue={filtro.desde} className="zx-control" />
            </Campo>
            <Campo etiqueta="Hasta (incluido)">
              <input type="date" name="hasta" defaultValue={filtro.hasta} className="zx-control" />
            </Campo>
            <Boton type="submit" chico>
              Actualizar
            </Boton>
            {!filtro.esMesActual && (
              <BotonLink href="/panel" variante="fantasma" chico>
                Mes actual
              </BotonLink>
            )}
          </form>
          {filtro.error && <p className={styles.avisoError}>{filtro.error} Se muestra el mes en curso.</p>}
          <p className={styles.ayuda}>Hasta 31 días. {filtro.esMesActual ? "La variación es contra los mismos días del mes anterior." : ""}</p>
        </Tarjeta>
        <Tarjetas ind={periodo} completo tablero={tablero} />

        <div className={styles.gridGraficas}>
          <Tarjeta className={styles.panel}>
            <h3 className={styles.subtitulo}>Participación por cuenta (ventas)</h3>
            <Participacion filas={periodo.porCuenta} />
          </Tarjeta>
          <Tarjeta className={styles.panel}>
            <h3 className={styles.subtitulo}>Publicidad · inversión por cuenta (sin IVA)</h3>
            <InversionPublicidad publicidad={periodo.publicidad.mes} />
          </Tarjeta>
        </div>
        <Tarjeta className={styles.panel}>
          <h3 className={styles.subtitulo}>Comparativo por cuenta (equipo)</h3>
          <Comparativo filas={periodo.porCuenta} />
        </Tarjeta>
      </section>

      <section aria-label="Operación" className={styles.seccion}>
        <Tarjeta className={styles.encabezado}>
          <h2 className={styles.titulo}>
            Operación <span className={styles.rango}>(estado de ahora, no depende de las fechas)</span>
          </h2>
        </Tarjeta>
        {operacion}
      </section>
    </div>
  );
}
