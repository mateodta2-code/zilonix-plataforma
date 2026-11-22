import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import {
  armarFilas,
  DIAS_PARA_DESACTUALIZADO,
  ETIQUETA_TIPO_CUENTA,
  historialDeCuenta,
  MONEDAS_DISPONIBLE,
  TIPOS_CUENTA_DISPONIBLE,
  totalesPorMoneda,
  totalesPorTipo,
  type TotalDisponible,
} from "@/lib/finanzas/disponible";
import { leerDisponible } from "@/lib/finanzas/disponible-consulta";
import { diaBogota } from "@/lib/finanzas/utilidad-venta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { cambiarActivaCuentaDisponibleAction, crearCuentaDisponibleAction, registrarSaldoDisponibleAction } from "./actions";
import styles from "../finanzas.module.css";

// Issue #422 (fase 6 de Finanzas) — Disponible: «¿cuánta plata tengo hoy
// y dónde?». Ver exige finanzas.consultar; crear cuentas, registrar
// saldos y desactivar, finanzas.modificar (también en actions.ts y en
// lib/finanzas/disponible-consulta.ts). Los saldos se registran a mano:
// el de Mercado Pago llega cuando exista la app (sin llamar a su API
// todavía) y subir el extracto bancario queda para otro PR.

const ETIQUETA_TIPO_SINGULAR = { banco: "Banco", billetera: "Billetera", efectivo: "Efectivo" } as const;

function porMoneda(totales: TotalDisponible[]): string | undefined {
  if (totales.length === 0) return undefined;
  return totales.map((t) => mostrarMontoIso(t.total, t.moneda)).join(" · ");
}

function detalleTotal(totales: TotalDisponible[]): string[] {
  if (totales.length === 0) return [];
  const cuentas = totales.reduce((n, t) => n + t.cuentas, 0);
  const desactualizadas = totales.reduce((n, t) => n + t.desactualizadas, 0);
  const antiguo = totales.map((t) => t.corteMasAntiguo).filter((f): f is string => f !== null).sort()[0];
  const reciente = totales.map((t) => t.corteMasReciente).filter((f): f is string => f !== null).sort().pop();
  return [
    antiguo === reciente ? `Fecha de corte: ${antiguo}.` : `Fecha de corte: del ${antiguo} al ${reciente}.`,
    `${cuentas} ${cuentas === 1 ? "cuenta" : "cuentas"}.`,
    ...(desactualizadas > 0
      ? [`${desactualizadas} con saldo de hace más de ${DIAS_PARA_DESACTUALIZADO} días: el total puede no ser el de hoy.`]
      : []),
  ];
}

export default async function DisponiblePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  let puedeModificar = false;
  let datos;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
    datos = await leerDisponible(empresa.id, usuario.id);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const hoy = diaBogota(new Date());
  const filas = armarFilas(datos.cuentas, datos.saldos, hoy);
  const totales = totalesPorMoneda(filas);
  const porTipo = totalesPorTipo(filas);
  const activas = filas.filter((f) => f.activa);
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina
        titulo="Disponible"
        descripcion="Cuánta plata tienes hoy y dónde: bancos, billeteras y efectivo, con el último saldo que registraste de cada cuenta."
      />

      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <section className={styles.gridKpi}>
        <TarjetaKpi titulo="Total disponible" valor={porMoneda(totales)} detalle={detalleTotal(totales)} textoVacio="Sin saldos registrados" />
        {porTipo.map(({ tipo, totales: t }) => (
          <TarjetaKpi key={tipo} titulo={ETIQUETA_TIPO_CUENTA[tipo]} valor={porMoneda(t)} detalle={detalleTotal(t)} textoVacio="Sin saldos registrados" />
        ))}
      </section>

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Cuentas</h2>
        <Tabla
          encabezados={[
            "Cuenta",
            "Tipo",
            "Entidad",
            { clave: "saldo", contenido: "Saldo vigente", numerica: true },
            "Fecha de corte",
            "Estado",
            ...(puedeModificar ? [""] : []),
          ]}
        >
          {filas.map((f) => (
            <FilaTabla key={f.id}>
              <CeldaTabla>
                <strong>{f.nombre}</strong>
                {f.ultimos4 && <span className={styles.suave}> · •••• {f.ultimos4}</span>}
              </CeldaTabla>
              <CeldaTabla>{ETIQUETA_TIPO_SINGULAR[f.tipo]}</CeldaTabla>
              <CeldaTabla>{f.entidad ?? "—"}</CeldaTabla>
              <CeldaTabla numerica>{f.saldo === null ? <span className={styles.suave}>Sin saldo</span> : mostrarMontoIso(f.saldo, f.moneda)}</CeldaTabla>
              <CeldaTabla>
                {f.fechaCorte ?? "—"}
                {f.desactualizado && (
                  <>
                    {" "}
                    <Chip estado="advertencia" title={`Más de ${DIAS_PARA_DESACTUALIZADO} días desde la fecha de corte`}>
                      Desactualizado
                    </Chip>
                  </>
                )}
              </CeldaTabla>
              <CeldaTabla>{f.activa ? <Chip estado="exito">Activa</Chip> : <Chip>Inactiva</Chip>}</CeldaTabla>
              {puedeModificar && (
                <CeldaTabla>
                  <form action={cambiarActivaCuentaDisponibleAction}>
                    <input type="hidden" name="cuentaId" value={f.id} />
                    <input type="hidden" name="activa" value={f.activa ? "0" : "1"} />
                    <Boton type="submit" variante="fantasma">
                      {f.activa ? "Desactivar" : "Reactivar"}
                    </Boton>
                  </form>
                </CeldaTabla>
              )}
            </FilaTabla>
          ))}
          {/* El saldo automático llega cuando Mateo cree la app de Mercado
              Pago; hasta entonces no se llama a su API ni suma al total. */}
          <FilaTabla>
            <CeldaTabla>
              <strong>Mercado Pago (pendiente de conectar)</strong>
            </CeldaTabla>
            <CeldaTabla>Billetera</CeldaTabla>
            <CeldaTabla>Mercado Pago</CeldaTabla>
            <CeldaTabla numerica>
              <span className={styles.suave}>—</span>
            </CeldaTabla>
            <CeldaTabla>—</CeldaTabla>
            <CeldaTabla>
              <Chip>Pendiente</Chip>
            </CeldaTabla>
            {puedeModificar && <CeldaTabla>{""}</CeldaTabla>}
          </FilaTabla>
        </Tabla>
        {filas.length === 0 && (
          <EstadoVacio>Todavía no tienes cuentas. {puedeModificar ? "Crea la primera abajo." : "Pide a quien administra Finanzas que las cree."}</EstadoVacio>
        )}
      </Tarjeta>

      {puedeModificar && (
        <section className={styles.seccion}>
          <div className={styles.grilla}>
            <Tarjeta>
              <h2 className={styles.tituloSeccion}>Registrar saldo</h2>
              {activas.length === 0 ? (
                <EstadoVacio>Primero crea una cuenta.</EstadoVacio>
              ) : (
                <form action={registrarSaldoDisponibleAction} className={styles.form}>
                  <Campo etiqueta="Cuenta">
                    <select name="cuentaId" required className="zx-control">
                      {activas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre} ({c.moneda})
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Saldo (negativo si está sobregirada)">
                    <input name="saldo" required inputMode="decimal" placeholder="Ej. 1.234.567,89" className="zx-control" />
                  </Campo>
                  <Campo etiqueta="Fecha de corte">
                    <input name="fechaCorte" type="date" required max={hoy} defaultValue={hoy} className="zx-control" />
                  </Campo>
                  <Campo etiqueta="Nota (opcional)">
                    <input name="nota" maxLength={200} className="zx-control" />
                  </Campo>
                  <Boton type="submit" variante="primario">
                    Registrar saldo
                  </Boton>
                </form>
              )}
            </Tarjeta>

            <Tarjeta>
              <h2 className={styles.tituloSeccion}>Nueva cuenta</h2>
              <form action={crearCuentaDisponibleAction} className={styles.form}>
                <Campo etiqueta="Nombre">
                  <input name="nombre" required maxLength={80} placeholder="Ej. Ahorros principal" className="zx-control" />
                </Campo>
                <Campo etiqueta="Tipo">
                  <select name="tipo" required defaultValue="banco" className="zx-control">
                    {TIPOS_CUENTA_DISPONIBLE.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA_TIPO_SINGULAR[t]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Entidad (vacío solo para efectivo)">
                  <input name="entidad" maxLength={60} placeholder="Ej. Bancolombia o Nequi" className="zx-control" />
                </Campo>
                <Campo etiqueta="Últimos 4 dígitos (opcional)">
                  <input name="ultimos4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className="zx-control" />
                </Campo>
                <Campo etiqueta="Moneda">
                  <select name="moneda" required defaultValue={datos.monedaSugerida} className="zx-control">
                    {MONEDAS_DISPONIBLE.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Boton type="submit" variante="primario">
                  Crear cuenta
                </Boton>
              </form>
            </Tarjeta>
          </div>
        </section>
      )}

      {filas.length > 0 && (
        <section className={styles.seccion}>
          <Tarjeta>
            <h2 className={styles.tituloSeccion}>Historial de saldos</h2>
            {filas.map((f) => {
              const historial = historialDeCuenta(datos.saldos, f.id);
              return (
                <details key={f.id}>
                  <summary>
                    {f.nombre} <span className={styles.suave}>· {historial.length} {historial.length === 1 ? "saldo" : "saldos"}</span>
                  </summary>
                  {historial.length === 0 ? (
                    <EstadoVacio>Sin saldos registrados.</EstadoVacio>
                  ) : (
                    <Tabla encabezados={["Fecha de corte", { clave: "saldo", contenido: "Saldo", numerica: true }, "Nota", "Registró"]}>
                      {historial.map((s, i) => (
                        <FilaTabla key={s.id}>
                          <CeldaTabla>
                            {s.fechaCorte}
                            {i === 0 && (
                              <>
                                {" "}
                                <Chip estado="exito">Vigente</Chip>
                              </>
                            )}
                          </CeldaTabla>
                          <CeldaTabla numerica>{mostrarMontoIso(s.saldo, f.moneda)}</CeldaTabla>
                          <CeldaTabla>{s.nota ?? "—"}</CeldaTabla>
                          <CeldaTabla>{s.registradoPor ?? "—"}</CeldaTabla>
                        </FilaTabla>
                      ))}
                    </Tabla>
                  )}
                </details>
              );
            })}
          </Tarjeta>
        </section>
      )}

      <BotonLink href="/panel/finanzas" variante="fantasma" className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
