import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { diaBogota } from "@/lib/finanzas/utilidad-venta";
import {
  DIAS_POR_VENCER,
  diasDeVencido,
  ESTADOS_POR_PAGAR,
  ETIQUETA_ESTADO_POR_PAGAR,
  ETIQUETA_ORIGEN_POR_PAGAR,
  leerFiltrosPorPagar,
  ORIGENES_POR_PAGAR,
} from "@/lib/finanzas/por-pagar";
import { leerPorPagar, type TotalesPorPagar } from "@/lib/finanzas/por-pagar-db";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { marcarPagadoPorPagarAction } from "./actions";
import styles from "../finanzas.module.css";

// Issue #422 (fase 5 de Finanzas) — cuentas por pagar: gastos externos
// pendientes, órdenes de compra sin pagar y, desde el 28-nov, el empaque
// y envío que las ventas despachadas le deben a los terceros habituales. Ver exige
// finanzas.consultar; «Marcar pagado», finanzas.modificar (también en el
// servidor). Cada monto con su moneda; los totales nunca mezclan monedas
// y salen de agregados en SQL (lib/finanzas/por-pagar-db.ts).

const RUTA = "/panel/finanzas/por-pagar";

function porMoneda(totales: TotalesPorPagar[], campo: "total" | "vencido" | "porVencer" | "despues"): string {
  if (totales.length === 0) return "—";
  return totales.map((t) => mostrarMontoIso(t[campo], t.moneda)).join(" · ");
}

export default async function PorPagarPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  const hoy = diaBogota(new Date());
  const filtros = leerFiltrosPorPagar(searchParams);

  let puedeModificar = false;
  let datos;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
    datos = await leerPorPagar(empresa.id, usuario.id, filtros, hoy);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }
  const { filas, totales, proveedores, truncado } = datos;

  const claveFiltroProveedor =
    filtros.proveedor?.tipo === "tercero" ? `t:${filtros.proveedor.id}` : filtros.proveedor ? `b:${filtros.proveedor.nombre}` : "";
  const hayFiltros = filtros.origen !== null || filtros.estado !== null || filtros.proveedor !== null;

  // Para volver a esta misma vista después de marcar pagado.
  const consulta = new URLSearchParams();
  if (filtros.origen) consulta.set("origen", filtros.origen);
  if (filtros.estado) consulta.set("estado", filtros.estado);
  if (claveFiltroProveedor) consulta.set("proveedor", claveFiltroProveedor);
  const volver = `${RUTA}?${consulta.toString()}`;

  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);
  const partidas = totales.reduce((n, t) => n + t.partidas, 0);

  return (
    <>
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion="Lo que la empresa debe y aún no ha pagado: gastos externos pendientes, órdenes de compra sin pagar y el empaque y envío que las ventas despachadas le deben a tus proveedores habituales de empaque, agencia y Flex (se suma solo con cada venta)."
      />

      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <section className={styles.gridKpi}>
        <TarjetaKpi
          titulo="Total por pagar"
          valor={porMoneda(totales, "total")}
          detalle={[`${partidas} ${partidas === 1 ? "partida" : "partidas"}${hayFiltros ? " con estos filtros" : ""}.`]}
        />
        <TarjetaKpi titulo="Vencido" valor={porMoneda(totales, "vencido")} detalle={["La fecha de vencimiento ya pasó (día de Bogotá)."]} />
        <TarjetaKpi
          titulo={`Vence en ${DIAS_POR_VENCER} días`}
          valor={porMoneda(totales, "porVencer")}
          detalle={[`Vence de hoy (${hoy}) a ${DIAS_POR_VENCER} días.`]}
        />
        <TarjetaKpi
          titulo="Por pagar después"
          valor={porMoneda(totales, "despues")}
          detalle={["Vence más adelante o no tiene fecha de vencimiento (las órdenes de compra no la guardan)."]}
        />
      </section>

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Origen">
          <select name="origen" defaultValue={filtros.origen ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ORIGENES_POR_PAGAR.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORIGEN_POR_PAGAR[o]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Proveedor">
          <select name="proveedor" defaultValue={claveFiltroProveedor} className="zx-control">
            <option value="">Todos</option>
            {proveedores.map((p) => (
              <option key={p.clave} value={p.clave}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={filtros.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_POR_PAGAR.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_POR_PAGAR[e]}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">Filtrar</Boton>
          {hayFiltros && (
            <BotonLink href={RUTA} variante="fantasma">
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Partidas pendientes</h2>
        {filas.length === 0 ? (
          <EstadoVacio>
            No hay nada por pagar{hayFiltros ? " con estos filtros" : ""}. Los gastos se registran en Gastos; las órdenes de compra, en Productos → Registro de compras. El empaque y el envío de las ventas se suman solos cuando hay
            un proveedor habitual de empaque, agencia o Flex marcado en Finanzas → Configuración → Proveedores.
          </EstadoVacio>
        ) : (
          <>
            {truncado && <p className={styles.suave}>Se muestran las primeras {filas.length} partidas; los totales de arriba sí cuentan todas.</p>}
            <Tabla
              scroll
              encabezados={[
                "Origen",
                "Proveedor",
                "Concepto",
                "Vence",
                { clave: "dias", contenido: "Días de vencido", numerica: true },
                { clave: "valor", contenido: "Valor", numerica: true },
                "Estado",
                ...(puedeModificar ? [""] : []),
              ]}
            >
              {filas.map((f) => (
                <FilaTabla key={`${f.origen}-${f.id}`}>
                  <CeldaTabla>{ETIQUETA_ORIGEN_POR_PAGAR[f.origen]}</CeldaTabla>
                  <CeldaTabla>{f.proveedor ?? <span className={styles.suave}>Sin proveedor</span>}</CeldaTabla>
                  <CeldaTabla>
                    {f.concepto}
                    {f.categoria && <span className={styles.suave}> · {f.categoria}</span>}
                  </CeldaTabla>
                  <CeldaTabla>{f.vence ?? <span className={styles.suave}>Sin fecha</span>}</CeldaTabla>
                  <CeldaTabla numerica>{f.estado === "vencido" ? diasDeVencido(f.vence, hoy) : "—"}</CeldaTabla>
                  <CeldaTabla numerica>{mostrarMontoIso(f.valor, f.moneda)}</CeldaTabla>
                  <CeldaTabla>{f.estado === "vencido" ? <strong>{ETIQUETA_ESTADO_POR_PAGAR[f.estado]}</strong> : ETIQUETA_ESTADO_POR_PAGAR[f.estado]}</CeldaTabla>
                  {puedeModificar && (
                    <CeldaTabla>
                      <form action={marcarPagadoPorPagarAction} className={styles.acciones}>
                        <input type="hidden" name="origen" value={f.origen} />
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="volver" value={volver} />
                        <input type="date" name="fechaPago" required defaultValue={hoy} aria-label="Fecha de pago" className="zx-control" />
                        <input name="medioPago" maxLength={60} placeholder="Medio" aria-label="Medio de pago" className="zx-control" />
                        <Boton type="submit" variante="secundario" chico>
                          Marcar pagado
                        </Boton>
                      </form>
                    </CeldaTabla>
                  )}
                </FilaTabla>
              ))}
            </Tabla>
          </>
        )}
      </Tarjeta>

      <BotonLink href="/panel/finanzas" variante="fantasma" className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
