import { randomUUID } from "crypto";
import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { instruccionAlerta, listarAlertasPendientes } from "@/lib/inventario/alertas";
import { listarSkusConStock } from "@/lib/inventario/stock";
import { claveFilaInventario, listarInventarioPorBodega, TAMANO_PAGINA_INVENTARIO_BODEGA } from "@/lib/inventario/vista-inventario";
import { leerFichasProducto, type FichaProducto } from "@/lib/inventario/ficha-producto";
import { urlFotoGrandeMl } from "@/lib/ml/imagen-ml";
import { formatearMonto } from "@/lib/panel-kpis";
import { resolverAlertaAction, trasladarStockAction } from "./actions";
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
import { FotoInventario } from "@/components/inventario/FotoInventario";
import { AccionesFilaInventario } from "@/components/inventario/AccionesFilaInventario";

// Issue #280 — stock por SKU y bodega (WMS Fase 1). Seller es la fuente
// de verdad: lo que se ve acá es lo que se publica en ML (menos el
// colchón), no lo que diga Fulfy. Ver pide inventario.consultar;
// trasladar, Modificar (ingreso/salida y datos) y resolver la alerta de
// última unidad, inventario.modificar (también en cada acción). Una
// fila por SKU+bodega, como el inventario de Zilonix OS. El cuadro
// «Ajuste» salió de esta vista (Franky, 28-nov); ajustarStockAction
// sigue en actions.ts.
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
  // Cambiar costo/precio: el mismo permiso que la maestra de Finanzas.
  const cambiaFinanzas = veFinanzas && tienePermiso(permisos, "finanzas", "modificar");
  const q = normalizarParametro(searchParams.q);

  const [resultado, lista, alertas, skusSimples] = await Promise.all([
    listarInventarioPorBodega(activa.id, { busqueda: q, pagina: parsearPagina(normalizarParametro(searchParams.pagina)) }),
    listarBodegas(activa.id),
    listarAlertasPendientes(activa.id),
    puedeMover ? listarSkusConStock(activa.id) : Promise.resolve([]),
  ]);
  // Solo los SKU (únicos) de esta página, nunca toda la empresa.
  const unicos = new Map(resultado.filas.map((f) => [f.skuId, { id: f.skuId, codigo: f.codigo }]));
  const fichas = await leerFichasProducto(activa.id, [...unicos.values()]);
  const activas = lista.filter((b) => b.activa);
  const bodegasModal = activas.map((b) => ({ id: b.id, nombre: b.nombre, esPrincipal: b.esPrincipal }));
  // Traslado «Desde»: activas más las desactivadas que todavía tienen
  // algo en esta página (las filas ya traen solo esas).
  const conSaldo = new Set(resultado.filas.map((f) => f.bodegaId).filter((id): id is string => id !== null));
  const hrefPagina = (p: number) => `/panel/inventario?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { pagina: String(p) } : {}) })}`;

  return (
    <>
      <EncabezadoPagina
        titulo="Inventario"
        descripcion="Stock disponible por SKU y bodega. Costo, venta y proveedor. Desde Acciones puedes ver el historial o modificar el producto."
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

      {/* Solo queda el Traslado (el Ajuste salió de esta vista). */}
      {puedeMover && activas.length > 1 && skusSimples.length > 0 && (
        <div className={styles.gridForms}>
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
              "Bodega",
              ...(veFinanzas ? ["Proveedor"] : []),
              "Acciones",
            ]}
          >
            {resultado.filas.map((f) => {
              const ficha = fichas.get(f.skuId);
              return (
                <FilaTabla key={claveFilaInventario(f)}>
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
                  {/* Disponible de ESA bodega; un kit no tiene saldo propio. */}
                  <CeldaTabla className={styles.numero}>{f.disponible ?? "—"}</CeldaTabla>
                  <CeldaTabla>{f.bodegaNombre ?? "—"}</CeldaTabla>
                  {veFinanzas && <CeldaTabla>{ficha?.proveedorNombre ?? "—"}</CeldaTabla>}
                  <CeldaTabla>
                    <AccionesFilaInventario
                      claseContenedor={styles.accionesFila}
                      skuId={f.skuId}
                      codigo={f.codigo}
                      nombre={f.nombre}
                      esKit={f.esKit}
                      bodegaId={f.bodegaId}
                      bodegas={bodegasModal}
                      costo={veFinanzas ? (ficha?.costo ?? null) : null}
                      precioVenta={veFinanzas ? (ficha?.precioVenta ?? null) : null}
                      puedeModificar={puedeMover}
                      veCostos={veFinanzas}
                      cambiaCostos={cambiaFinanzas}
                    />
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Página {resultado.pagina} de {resultado.totalPaginas} · {resultado.total} fila(s) · {TAMANO_PAGINA_INVENTARIO_BODEGA} por página
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
  return <FotoInventario src={ficha.fotoUrl} srcAmpliada={urlFotoGrandeMl(ficha.fotoUrl)} alt={nombre} claseMiniatura={styles.miniatura} />;
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
