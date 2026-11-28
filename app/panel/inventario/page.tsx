import { randomUUID } from "crypto";
import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { instruccionAlerta, listarAlertasPendientes } from "@/lib/inventario/alertas";
import { leerConfiguracionInventario } from "@/lib/inventario/configuracion";
import { calcularDiasStock, cantidadAPublicar, textoDiasStock } from "@/lib/inventario/calculos";
import { listarInventario, listarSkusConStock, TAMANO_PAGINA_INVENTARIO } from "@/lib/inventario/stock";
import { leerFichasProducto, type FichaProducto } from "@/lib/inventario/ficha-producto";
import { urlFotoGrandeMl } from "@/lib/ml/imagen-ml";
import { formatearMonto } from "@/lib/panel-kpis";
import { ajustarStockAction, resolverAlertaAction, trasladarStockAction } from "./actions";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl } from "@/components/inventario/Avisos";
import styles from "./inventario.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import { FotoConZoom } from "@/components/marco/FotoConZoom";

// Issue #280 — stock por SKU y bodega (WMS Fase 1). Seller es la fuente
// de verdad: lo que se ve acá es lo que se publica en ML (menos el
// colchón), no lo que diga Fulfy. Ver pide inventario.consultar;
// ajustar, trasladar y resolver la alerta de última unidad,
// inventario.modificar (también en cada acción).
export default async function InventarioPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeMover = tienePermiso(permisos, "inventario", "modificar");
  // Costo, venta y proveedor son de finanzas (mismo criterio que
  // Registro de compras): sin finanzas.consultar esas columnas no salen.
  const veFinanzas = tienePermiso(permisos, "finanzas", "consultar");
  const q = normalizarParametro(searchParams.q);

  const [resultado, lista, alertas, config, skusSimples] = await Promise.all([
    listarInventario(activa.id, { busqueda: q, pagina: parsearPagina(normalizarParametro(searchParams.pagina)) }),
    listarBodegas(activa.id),
    listarAlertasPendientes(activa.id),
    leerConfiguracionInventario(activa.id),
    puedeMover ? listarSkusConStock(activa.id) : Promise.resolve([]),
  ]);
  // Solo los SKU de esta página, nunca toda la empresa.
  const fichas = await leerFichasProducto(
    activa.id,
    resultado.filas.map((f) => ({ id: f.skuId, codigo: f.codigo }))
  );
  const activas = lista.filter((b) => b.activa);
  // Las columnas son las bodegas activas más las desactivadas que
  // todavía tienen algo (para no esconder stock real).
  const conSaldo = new Set(resultado.filas.flatMap((f) => f.porBodega.filter((b) => b.disponible || b.reservado).map((b) => b.bodegaId)));
  const columnas = lista.filter((b) => b.activa || conSaldo.has(b.id));
  const hrefPagina = (p: number) => `/panel/inventario?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { pagina: String(p) } : {}) })}`;

  return (
    <>
      <EncabezadoPagina
        titulo="Inventario"
        descripcion={`Stock por bodega. "Para ML" es lo que se publica: disponible de las bodegas que suman, menos un colchón de ${config.bufferMl}. "Días de stock" es para cuántos días alcanza, según lo vendido en ML en los últimos 30 días.`}
      />
      <AvisosUrl searchParams={searchParams} />

      {alertas.length > 0 && (
        <div className={styles.banner}>
          {alertas.map((a) => (
            <div key={a.id} className={styles.alerta}>
              <span>
                <strong>Última unidad · <SkuCopiable sku={a.codigo} /></strong> ({a.nombre}): quedan {a.disponibleAlCrear} para publicar. {instruccionAlerta(a.regla)}
              </span>
              {puedeMover && (
                <form action={resolverAlertaAction} className={styles.accionesAlerta}>
                  <input type="hidden" name="alertaId" value={a.id} />
                  <Boton type="submit" name="decision" value="aplicar">
                    Aplicar
                  </Boton>
                  <Boton type="submit" name="decision" value="no_aplicar" variante="secundario">
                    No aplicar
                  </Boton>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {lista.length === 0 && (
        <div className={styles.avisoSinVincular}>
          Para cargar stock primero crea una bodega.{" "}
          <Link href="/panel/bodegas" className={styles.enlaceAviso}>
            Ir a Bodegas
          </Link>
        </div>
      )}

      {puedeMover && activas.length > 0 && skusSimples.length > 0 && (
        <div className={styles.gridForms}>
          <Tarjeta>
            <h2 className={styles.tituloSeccion}>Ajuste</h2>
            <form action={ajustarStockAction} className={styles.form}>
              <input type="hidden" name="operacionId" value={randomUUID()} />
              <Campo etiqueta="SKU">
                <SelectorSku skus={skusSimples} />
              </Campo>
              <Campo etiqueta="Bodega">
                <SelectorBodega nombre="bodegaId" bodegas={activas} />
              </Campo>
              <Campo etiqueta="Cantidad (+ sobra, − falta)">
                <input name="cantidad" type="number" step={1} required className="zx-control" />
              </Campo>
              <Campo etiqueta="Motivo">
                <input name="nota" required maxLength={200} placeholder="Conteo, daño, pérdida…" className="zx-control" />
              </Campo>
              <Boton type="submit" className={styles.botonCrear}>
                Registrar ajuste
              </Boton>
            </form>
          </Tarjeta>
          {activas.length > 1 && (
            <Tarjeta>
              <h2 className={styles.tituloSeccion}>Traslado</h2>
              <form action={trasladarStockAction} className={styles.form}>
                <input type="hidden" name="operacionId" value={randomUUID()} />
                <Campo etiqueta="SKU">
                  <SelectorSku skus={skusSimples} />
                </Campo>
                <Campo etiqueta="Desde">
                  <SelectorBodega nombre="bodegaOrigenId" bodegas={lista.filter((b) => b.activa || conSaldo.has(b.id))} />
                </Campo>
                <Campo etiqueta="Hacia">
                  <SelectorBodega nombre="bodegaDestinoId" bodegas={activas} />
                </Campo>
                <Campo etiqueta="Cantidad">
                  <input name="cantidad" type="number" min={1} step={1} required className="zx-control" />
                </Campo>
                <Campo etiqueta="Nota (opcional)">
                  <input name="nota" maxLength={200} className="zx-control" />
                </Campo>
                <Boton type="submit" className={styles.botonCrear}>
                  Trasladar
                </Boton>
              </form>
            </Tarjeta>
          )}
        </div>
      )}

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Buscar">
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Código o nombre" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">
            Filtrar
          </Boton>
          {q && (
            <BotonLink href="/panel/inventario" variante="fantasma">
              Limpiar
            </BotonLink>
          )}
          {/* <a> normal (no Link): es una descarga, no una navegación. */}
          <a href={`/api/inventario/exportar${q ? `?${new URLSearchParams({ q })}` : ""}`} download className={clasesBoton("secundario", true)}>
            Descargar CSV
          </a>
        </div>
      </form>

      {resultado.total === 0 ? (
        <EstadoVacio>{q ? "Ningún SKU coincide con esa búsqueda." : "Todavía no hay SKU. Créalos en la pantalla de SKU."}</EstadoVacio>
      ) : (
        <>
          <Tabla
            encabezados={[
              "Foto",
              "Nombre",
              "SKU",
              ...(veFinanzas ? ["Costo", "Venta"] : []),
              "Stock",
              ...columnas.map((b) => b.nombre),
              "Reservado",
              "Para ML",
              "Días de stock",
              ...(veFinanzas ? ["Proveedor"] : []),
              "Acciones",
            ]}
          >
            {resultado.filas.map((f) => {
              const ficha = fichas.get(f.skuId);
              return (
                <FilaTabla key={f.skuId}>
                  <CeldaTabla>
                    <Foto ficha={ficha} nombre={f.nombre} />
                  </CeldaTabla>
                  <CeldaTabla>
                    {f.nombre} {f.esKit && <Chip>Kit</Chip>}
                  </CeldaTabla>
                  <CeldaTabla>
                    <strong><SkuCopiable sku={f.codigo} /></strong>
                  </CeldaTabla>
                  {veFinanzas && (
                    <>
                      <CeldaTabla className={styles.numero}>{montoOGuion(ficha?.costo ?? null)}</CeldaTabla>
                      <CeldaTabla className={styles.numero}>{montoOGuion(ficha?.precioVenta ?? null)}</CeldaTabla>
                    </>
                  )}
                  <CeldaTabla className={styles.numero}>{f.esKit ? "—" : f.totalDisponible}</CeldaTabla>
                  {columnas.map((b) => {
                    const saldo = f.porBodega.find((x) => x.bodegaId === b.id);
                    return (
                      <CeldaTabla key={b.id} className={styles.numero}>
                        {f.esKit ? "—" : (saldo?.disponible ?? 0)}
                      </CeldaTabla>
                    );
                  })}
                  <CeldaTabla className={styles.numero}>{f.esKit ? "—" : f.totalReservado}</CeldaTabla>
                  <CeldaTabla className={styles.numero}>
                    <strong>{cantidadAPublicar(f.publicable, config.bufferMl)}</strong>
                  </CeldaTabla>
                  <CeldaTabla className={styles.numero}>
                    <DiasStock esKit={f.esKit} paraMl={cantidadAPublicar(f.publicable, config.bufferMl)} vendidas30={f.vendidas30} />
                  </CeldaTabla>
                  {veFinanzas && <CeldaTabla>{ficha?.proveedorNombre ?? "—"}</CeldaTabla>}
                  <CeldaTabla>
                    {/* Acá entra después el botón «Modificar» (otra tarea). */}
                    <div className={styles.accionesFila}>
                      {!f.esKit && (
                        <BotonLink href={`/panel/inventario/kardex?sku=${f.skuId}`} variante="secundario" chico>
                          Historial ingresos
                        </BotonLink>
                      )}
                    </div>
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Página {resultado.pagina} de {resultado.totalPaginas} · {resultado.total} SKU · {TAMANO_PAGINA_INVENTARIO} por página
            </p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 && (
                <BotonLink href={hrefPagina(resultado.pagina - 1)} variante="secundario" chico>
                  Anterior
                </BotonLink>
              )}
              {resultado.pagina < resultado.totalPaginas && (
                <BotonLink href={hrefPagina(resultado.pagina + 1)} variante="secundario" chico>
                  Siguiente
                </BotonLink>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// "0.00" es un costo real ($0); solo vacío es «—».
function montoOGuion(monto: string | null): string {
  return monto === null ? "—" : formatearMonto(monto);
}

// La foto sale de la última venta del SKU (pedido_items.imagen_url)
// mientras `skus` no tenga foto propia (tarea futura con migración).
function Foto({ ficha, nombre }: { ficha: FichaProducto | undefined; nombre: string }) {
  if (!ficha?.fotoUrl) {
    return <div className={`${styles.miniatura} ${styles.miniaturaVacia} ${styles.detalle}`}>Sin foto</div>;
  }
  return <FotoConZoom src={ficha.fotoUrl} srcAmpliada={urlFotoGrandeMl(ficha.fotoUrl)} alt={nombre} claseMiniatura={styles.miniatura} />;
}

// Un kit no tiene ritmo propio: sus ventas ya suman a los componentes.
function DiasStock({ esKit, paraMl, vendidas30 }: { esKit: boolean; paraMl: number; vendidas30: number }) {
  if (esKit) return <>—</>;
  const dias = calcularDiasStock(paraMl, vendidas30);
  if (dias === null) return <span className={styles.detalle}>{textoDiasStock(dias)}</span>;
  return <span title={`${vendidas30} vendida(s) en ML en los últimos 30 días (sin Full ni canceladas)`}>{textoDiasStock(dias)}</span>;
}

function SelectorSku({ skus }: { skus: { id: string; codigo: string; nombre: string }[] }) {
  return (
    <select name="skuId" required className="zx-control" defaultValue="">
      <option value="" disabled>
        Elige un SKU
      </option>
      {skus.map((s) => (
        <option key={s.id} value={s.id}>
          {s.codigo} — {s.nombre}
        </option>
      ))}
    </select>
  );
}

function SelectorBodega({ nombre, bodegas }: { nombre: string; bodegas: { id: string; nombre: string; esPrincipal: boolean }[] }) {
  return (
    <select name={nombre} required className="zx-control" defaultValue={bodegas.find((b) => b.esPrincipal)?.id ?? ""}>
      <option value="" disabled>
        Elige una bodega
      </option>
      {bodegas.map((b) => (
        <option key={b.id} value={b.id}>
          {b.nombre}
        </option>
      ))}
    </select>
  );
}
