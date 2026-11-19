import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { leerPartidasPorCobrar } from "@/lib/finanzas/por-cobrar-consulta";
import {
  agruparPorCuenta,
  ETIQUETA_MARKETPLACE,
  filtrarPartidas,
  leerFiltrosPorCobrar,
  MARKETPLACES_POR_COBRAR,
  ordenarPartidas,
  resumirPorMoneda,
  ventanasBogota,
  type TotalesMoneda,
} from "@/lib/finanzas/por-cobrar";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "../finanzas.module.css";

// Issue #422 — cuentas por cobrar: cuánto le deben Mercado Libre y
// Falabella a la empresa. Solo lectura: finanzas.consultar (acá y en
// lib/finanzas/por-cobrar-consulta.ts). Cada monto con la moneda de su
// cuenta; los totales nunca mezclan monedas.

const RUTA = "/panel/finanzas/por-cobrar";

// "COP 1.000 · MXN 50" — una cifra por moneda.
function porMoneda(totales: TotalesMoneda[], campo: "total" | "estaSemana" | "proximoMes"): string {
  if (totales.length === 0) return "—";
  return totales.map((t) => mostrarMontoIso(t[campo], t.moneda)).join(" · ");
}

export default async function PorCobrarPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  const ahora = new Date();
  let todas;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    todas = await leerPartidasPorCobrar(empresa.id, usuario.id, ahora);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const filtros = leerFiltrosPorCobrar(searchParams);
  const ventanas = ventanasBogota(ahora);
  const partidas = filtrarPartidas(todas, filtros);
  const totales = resumirPorMoneda(partidas, ventanas);
  const filas = agruparPorCuenta(partidas, ventanas);
  const detalle = ordenarPartidas(partidas);
  // Tiendas del selector: las que tienen algo por cobrar, del marketplace elegido.
  const tiendas = agruparPorCuenta(filtrarPartidas(todas, { marketplace: filtros.marketplace, cuentaId: null }), ventanas).filter(
    (f, i, lista) => lista.findIndex((o) => o.cuentaId === f.cuentaId) === i
  );
  const hayFiltros = filtros.marketplace !== null || filtros.cuentaId !== null;
  const sinFecha = totales.filter((t) => t.sinFecha !== "0.00");

  return (
    <>
      <EncabezadoPagina
        titulo="Cuentas por cobrar"
        descripcion="Lo que Mercado Libre y Falabella todavía no te han pagado: ventas con la plata sin liberar y cortes de Falabella sin pagar."
      />

      <section className={styles.gridKpi}>
        <TarjetaKpi
          titulo="Total por cobrar"
          valor={porMoneda(totales, "total")}
          detalle={[
            `${partidas.length} ${partidas.length === 1 ? "partida" : "partidas"}.`,
            ...(sinFecha.length
              ? [`Sin fecha esperada (Falabella no la trae en el reporte): ${sinFecha.map((t) => mostrarMontoIso(t.sinFecha, t.moneda)).join(" · ")}.`]
              : []),
          ]}
        />
        <TarjetaKpi
          titulo="Entra esta semana"
          valor={porMoneda(totales, "estaSemana")}
          detalle={[`Fecha esperada hasta el domingo ${ventanas.semana.hasta} (día de Bogotá).`]}
        />
        <TarjetaKpi
          titulo="Entra el próximo mes"
          valor={porMoneda(totales, "proximoMes")}
          detalle={[`Fecha esperada del ${ventanas.proximoMes.desde} al ${ventanas.proximoMes.hasta}.`]}
        />
      </section>

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Marketplace">
          <select name="marketplace" defaultValue={filtros.marketplace ?? ""} className="zx-control">
            <option value="">Todos</option>
            {MARKETPLACES_POR_COBRAR.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_MARKETPLACE[m]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Tienda">
          <select name="cuenta" defaultValue={filtros.cuentaId ?? ""} className="zx-control">
            <option value="">Todas</option>
            {tiendas.map((t) => (
              <option key={t.cuentaId} value={t.cuentaId}>
                {t.cuenta} ({ETIQUETA_MARKETPLACE[t.marketplace]})
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltros && (
            <BotonLink href={RUTA} variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Por plataforma y cuenta</h2>
        {filas.length === 0 ? (
          <EstadoVacio>
            No hay nada por cobrar{hayFiltros ? " con estos filtros" : ""}. Las fechas de Mercado Libre llegan con la sincronización de ventas; los
            cortes de Falabella, al cargar el reporte de transacciones en Conciliación Falabella.
          </EstadoVacio>
        ) : (
          <Tabla
            encabezados={[
              "Marketplace",
              "Cuenta",
              "Partidas",
              "Próxima fecha",
              { clave: "semana", contenido: "Esta semana", numerica: true },
              { clave: "mes", contenido: "Próximo mes", numerica: true },
              { clave: "total", contenido: "Total", numerica: true },
            ]}
          >
            {filas.map((f) => (
              <FilaTabla key={`${f.marketplace}-${f.cuentaId}-${f.moneda}`}>
                <CeldaTabla>{ETIQUETA_MARKETPLACE[f.marketplace]}</CeldaTabla>
                <CeldaTabla>{f.cuenta}</CeldaTabla>
                <CeldaTabla>{f.partidas}</CeldaTabla>
                <CeldaTabla>{f.proximaFecha ?? "Sin fecha"}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMontoIso(f.estaSemana, f.moneda)}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMontoIso(f.proximoMes, f.moneda)}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMontoIso(f.total, f.moneda)}</CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      {detalle.length > 0 && (
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Detalle</h2>
          <Tabla
            scroll
            encabezados={[
              "Fecha esperada",
              "Marketplace",
              "Cuenta",
              "Orden / corte",
              "Estado",
              { clave: "monto", contenido: "Monto neto", numerica: true },
            ]}
          >
            {detalle.map((p) => (
              <FilaTabla key={`${p.marketplace}-${p.cuentaId}-${p.referencia}-${p.moneda}`}>
                <CeldaTabla>{p.fechaEsperada ?? "Sin fecha"}</CeldaTabla>
                <CeldaTabla>{ETIQUETA_MARKETPLACE[p.marketplace]}</CeldaTabla>
                <CeldaTabla>{p.cuenta}</CeldaTabla>
                <CeldaTabla>{p.referencia}</CeldaTabla>
                <CeldaTabla>{p.estado ?? "—"}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMontoIso(p.monto, p.moneda)}</CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        </Tarjeta>
      )}

      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
