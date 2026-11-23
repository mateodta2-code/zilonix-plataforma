import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { diaBogota } from "@/lib/finanzas/utilidad-venta";
import {
  claveTienda,
  ESTADOS_GASTO,
  ETIQUETA_ESTADO_GASTO,
  estaVencido,
  filtrarGastos,
  filtrarPorTiendaYCategoria,
  leerFiltrosGastos,
  mesDeDia,
  resumirGastos,
  type TotalesGastoMoneda,
} from "@/lib/finanzas/gastos";
import { leerGastosParaPantalla, leerOpcionesGasto, listarCategoriasGasto } from "@/lib/finanzas/gastos-db";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { crearGastoAction, marcarPagadoAction } from "./actions";
import { FormularioGasto } from "./FormularioGasto";
import styles from "../finanzas.module.css";

// Issue #422 (fase 4 de Finanzas) — gastos externos: lo que la empresa
// paga por fuera de las plataformas. Ver exige finanzas.consultar;
// crear, editar y marcar como pagado, finanzas.modificar (también en el
// servidor, en actions.ts y lib/finanzas/gastos-db.ts). Cada monto con
// su moneda; los totales nunca mezclan monedas.

const RUTA = "/panel/finanzas/gastos";

function porMoneda(totales: TotalesGastoMoneda[], campo: "totalMes" | "pendiente" | "vencido"): string {
  if (totales.length === 0) return "—";
  return totales.map((t) => mostrarMontoIso(t[campo], t.moneda)).join(" · ");
}

export default async function GastosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  const hoy = diaBogota(new Date());
  const filtros = leerFiltrosGastos(searchParams, hoy);

  let puedeModificar = false;
  let datos;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
    const [filas, opciones, categorias] = await Promise.all([
      leerGastosParaPantalla(empresa.id, usuario.id, filtros, hoy),
      leerOpcionesGasto(empresa.id, usuario.id),
      listarCategoriasGasto(empresa.id, usuario.id, { incluirInactivas: true }),
    ]);
    datos = { filas, opciones, categorias };
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }
  const { filas, opciones, categorias } = datos;

  const totales = resumirGastos(filtrarPorTiendaYCategoria(filas, filtros), hoy);
  const lista = filtrarGastos(filas, filtros, hoy);
  const nombreTienda = new Map(opciones.tiendas.map((t) => [t.clave, t.nombre]));
  const mes = mesDeDia(hoy);
  const hayFiltros =
    filtros.desde !== mes.desde || filtros.hasta !== mes.hasta || filtros.tienda !== null || filtros.categoriaId !== null || filtros.estado !== null;

  // Para volver a esta misma vista después de crear o pagar.
  const consulta = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
  if (filtros.tienda) consulta.set("tienda", filtros.tienda);
  if (filtros.categoriaId) consulta.set("categoria", filtros.categoriaId);
  if (filtros.estado) consulta.set("estado", filtros.estado);
  const volver = `${RUTA}?${consulta.toString()}`;

  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina
        titulo="Gastos externos"
        descripcion="Lo que pagas por fuera de las plataformas: arriendo, nómina, empaques, contador, transportadoras…"
        accion={
          <BotonLink href={`${RUTA}/categorias`} variante="fantasma">
            Categorías
          </BotonLink>
        }
      />

      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <section className={styles.gridKpi}>
        <TarjetaKpi titulo="Total del mes" valor={porMoneda(totales, "totalMes")} detalle={[`Gastos con fecha del ${mes.desde} al ${mes.hasta}, pagados o no.`]} />
        <TarjetaKpi titulo="Pendiente por pagar" valor={porMoneda(totales, "pendiente")} detalle={["Todo lo que sigue pendiente, de cualquier fecha."]} />
        <TarjetaKpi
          titulo="Vencido"
          valor={porMoneda(totales, "vencido")}
          detalle={["Pendiente con la fecha de vencimiento ya pasada (día de Bogotá)."]}
        />
      </section>

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Desde">
          <input type="date" name="desde" defaultValue={filtros.desde} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" name="hasta" defaultValue={filtros.hasta} className="zx-control" />
        </Campo>
        <Campo etiqueta="Tienda">
          <select name="tienda" defaultValue={filtros.tienda ?? ""} className="zx-control">
            <option value="">Todas</option>
            <option value="empresa">Sin tienda (toda la empresa)</option>
            {opciones.tiendas.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Categoría">
          <select name="categoria" defaultValue={filtros.categoriaId ?? ""} className="zx-control">
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Estado">
          <select name="estado" defaultValue={filtros.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {ESTADOS_GASTO.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_GASTO[e]}
              </option>
            ))}
            <option value="vencido">Vencido</option>
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

      {puedeModificar && (
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Nuevo gasto</h2>
          {categorias.some((c) => c.activa) ? (
            <FormularioGasto
              accion={crearGastoAction}
              hoy={hoy}
              tiendas={opciones.tiendas}
              categorias={categorias}
              proveedores={opciones.proveedores}
              volver={volver}
              textoBoton="Registrar gasto"
            />
          ) : (
            <EstadoVacio>No hay categorías activas. Crea o reactiva una en Categorías.</EstadoVacio>
          )}
        </Tarjeta>
      )}

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Gastos</h2>
        {lista.length === 0 ? (
          <EstadoVacio>No hay gastos{hayFiltros ? " con estos filtros" : " este mes"}.</EstadoVacio>
        ) : (
          <Tabla
            scroll
            encabezados={[
              "Fecha",
              "Descripción",
              "Categoría",
              "A quién",
              "Tienda",
              "Vence",
              "Estado",
              { clave: "monto", contenido: "Monto", numerica: true },
              ...(puedeModificar ? [""] : []),
            ]}
          >
            {lista.map((g) => (
              <FilaTabla key={g.id}>
                <CeldaTabla>{g.fechaGasto}</CeldaTabla>
                <CeldaTabla>
                  {g.descripcion}
                  {g.soporte && <span className={styles.suave}> · {g.soporte}</span>}
                </CeldaTabla>
                <CeldaTabla>{g.categoria}</CeldaTabla>
                <CeldaTabla>{g.proveedor ?? g.beneficiario ?? "—"}</CeldaTabla>
                <CeldaTabla>{nombreTienda.get(claveTienda(g)) ?? "Empresa"}</CeldaTabla>
                <CeldaTabla>{g.fechaVencimiento ?? "—"}</CeldaTabla>
                <CeldaTabla>
                  {g.estado === "pagado" ? (
                    <>
                      Pagado {g.fechaPago}
                      {g.medioPago && <span className={styles.suave}> · {g.medioPago}</span>}
                    </>
                  ) : estaVencido(g, hoy) ? (
                    <strong>Vencido</strong>
                  ) : (
                    "Pendiente"
                  )}
                </CeldaTabla>
                <CeldaTabla numerica>{mostrarMontoIso(g.monto, g.moneda)}</CeldaTabla>
                {puedeModificar && (
                  <CeldaTabla>
                    {g.estado === "pendiente" && (
                      <form action={marcarPagadoAction} className={styles.acciones}>
                        <input type="hidden" name="gastoId" value={g.id} />
                        <input type="hidden" name="volver" value={volver} />
                        <input type="date" name="fechaPago" required defaultValue={hoy} aria-label="Fecha de pago" className="zx-control" />
                        <input name="medioPago" maxLength={60} placeholder="Medio" aria-label="Medio de pago" className="zx-control" />
                        <Boton type="submit" variante="secundario" chico>
                          Marcar pagado
                        </Boton>
                      </form>
                    )}
                    <BotonLink href={`${RUTA}/${g.id}`} variante="fantasma" chico>
                      Editar
                    </BotonLink>
                  </CeldaTabla>
                )}
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <BotonLink href="/panel/finanzas" variante="fantasma" className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
