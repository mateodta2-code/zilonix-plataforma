import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { listarDevoluciones, listarTiendasDevolucion, NOMBRE_BODEGA_AVERIADOS } from "@/lib/inventario/devoluciones";
import { fechaCorta, hoyBogota } from "@/lib/inventario/registro-compras";
import { listarSkusConStock } from "@/lib/inventario/stock";
import { anularDevolucionAction, recibirDevolucionAction, registrarDevolucionAction, traerDevolucionesMlAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl } from "@/components/inventario/Avisos";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import styles from "../inventario.module.css";

// Productos → Devoluciones (28-nov) — lo que pidió el usuario: fecha, SKU,
// nombre, cantidad, estado (bueno o averiado), tienda y el aviso de que
// está por llegar. Las de Mercado Libre se traen con «Traer devoluciones
// de Mercado Libre»; las demás se registran a mano. Al recibir, «bueno»
// suma al stock de la bodega elegida y «averiado», a «Averiados» (no suma
// a lo publicado en ML). Ver pide inventario.consultar; lo demás,
// inventario.crear (anular, inventario.anular), también en cada acción.
const ENCABEZADOS = ["Fecha", "SKU", "Nombre del producto", "Cantidad", "Estado", "Bueno / averiado", "Tienda", "Orden", "Recibir"];

export default async function DevolucionesInventarioPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  const puedeAnular = tienePermiso(permisos, "inventario", "anular");
  const buscar = (normalizarParametro(searchParams.buscar) ?? "").trim().slice(0, 120);
  const [filas, bodegasActivas, skusSimples, tiendas] = await Promise.all([
    listarDevoluciones(activa.id, buscar),
    puedeCrear ? listarBodegas(activa.id, { soloActivas: true }) : Promise.resolve([]),
    puedeCrear ? listarSkusConStock(activa.id) : Promise.resolve([]),
    puedeCrear ? listarTiendasDevolucion(activa.id) : Promise.resolve([]),
  ]);
  // «Bueno» entra a una bodega normal; Averiados se elige sola.
  const bodegasBuenas = bodegasActivas.filter((b) => b.nombre !== NOMBRE_BODEGA_AVERIADOS);
  const principal = bodegasBuenas.find((b) => b.esPrincipal)?.id ?? bodegasBuenas[0]?.id;
  const porLlegar = filas.filter((f) => f.estado === "por_llegar").length;

  return (
    <>
      <EncabezadoPagina
        titulo="Devoluciones"
        descripcion="Lo que vuelve de tus clientes. Las de Mercado Libre aparecen solas como «por llegar»; al recibirlas eliges si llegaron bien (suman al stock) o averiadas (van a la bodega Averiados)."
      />
      <AvisosUrl searchParams={searchParams} />

      {puedeCrear && (
        <div className={styles.filaForm} style={{ marginBottom: 12 }}>
          <form action={traerDevolucionesMlAction}>
            <Boton type="submit">Traer devoluciones de Mercado Libre</Boton>
          </form>
          <span className={styles.detalle}>Lee de Mercado Libre las devoluciones de los últimos 60 días con el envío de vuelta en camino o entregado.</span>
        </div>
      )}

      {puedeCrear && skusSimples.length > 0 && (
        <Tarjeta>
          <details>
            <summary className={styles.tituloSeccion} style={{ cursor: "pointer" }}>
              + Registrar devolución a mano (Falabella u otra tienda)
            </summary>
            <form action={registrarDevolucionAction} className={styles.gridCompra} style={{ marginTop: 12 }}>
              <Campo etiqueta="Fecha">
                <input type="date" name="fecha" defaultValue={hoyBogota(new Date())} required className="zx-control" />
              </Campo>
              <Campo etiqueta="Tienda">
                <select name="tienda" className="zx-control" defaultValue={tiendas[0]?.valor ?? "otra"}>
                  {tiendas.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.nombre}
                    </option>
                  ))}
                  <option value="otra">Otra (escríbela)</option>
                </select>
              </Campo>
              <Campo etiqueta="Otra tienda">
                <input name="tiendaOtra" maxLength={60} placeholder="Solo si elegiste «Otra»" className="zx-control" />
              </Campo>
              <div className={styles.span2}>
                <Campo etiqueta="SKU">
                  <select name="skuId" required className="zx-control" defaultValue="">
                    <option value="" disabled>
                      Elige el SKU…
                    </option>
                    {skusSimples.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} — {s.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <Campo etiqueta="Cantidad">
                <input name="cantidad" type="number" min={1} step={1} defaultValue={1} required className="zx-control" />
              </Campo>
              <Campo etiqueta="Nº de orden (opcional)">
                <input name="pedido" maxLength={80} className="zx-control" />
              </Campo>
              <div className={styles.span3}>
                <Campo etiqueta="Nota (opcional)">
                  <input name="nota" maxLength={200} className="zx-control" />
                </Campo>
              </div>
              <div className={styles.celdaBoton}>
                <Boton type="submit">Registrar</Boton>
              </div>
            </form>
          </details>
        </Tarjeta>
      )}

      <form method="get" className={styles.filtros}>
        <label className={styles.campoBusqueda} style={{ flex: "1 1 320px" }}>
          <span className="zx-etiqueta">Buscar</span>
          <input type="search" name="buscar" defaultValue={buscar} placeholder="SKU, producto, orden o tienda…" className="zx-control" />
        </label>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">Buscar</Boton>
          {buscar && (
            <BotonLink href="/panel/inventario/devoluciones" variante="fantasma">
              Limpiar
            </BotonLink>
          )}
        </div>
      </form>

      {filas.length === 0 ? (
        <EstadoVacio>
          {buscar ? `No hay devoluciones que coincidan con «${buscar}».` : "Todavía no hay devoluciones. Usa «Traer devoluciones de Mercado Libre» o regístralas a mano."}
        </EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={ENCABEZADOS} scroll>
            {filas.map((f) => (
              <FilaTabla key={f.id}>
                <CeldaTabla>{fechaCorta(f.fecha)}</CeldaTabla>
                <CeldaTabla>{f.skuCodigo ? <SkuCopiable sku={f.skuCodigo} /> : <Chip estado="aviso">sin SKU</Chip>}</CeldaTabla>
                <CeldaTabla>
                  <div style={{ minWidth: 200, maxWidth: 320, whiteSpace: "normal" }}>{f.producto}</div>
                </CeldaTabla>
                <CeldaTabla className={styles.numero}>{f.cantidad}</CeldaTabla>
                <CeldaTabla>
                  {f.estado === "por_llegar" ? (
                    <>
                      <Chip estado="aviso">por llegar</Chip>
                      {f.estadoEnvioMl && <div className={styles.detalle}>{f.estadoEnvioMl}</div>}
                    </>
                  ) : f.estado === "recibida" ? (
                    <>
                      <Chip estado="exito">recibida</Chip>
                      {f.bodega && <div className={styles.detalle}>en {f.bodega}</div>}
                    </>
                  ) : (
                    <Chip>anulada</Chip>
                  )}
                </CeldaTabla>
                <CeldaTabla>{f.condicion === "bueno" ? <Chip estado="exito">bueno</Chip> : f.condicion === "averiado" ? <Chip estado="peligro">averiado</Chip> : "—"}</CeldaTabla>
                <CeldaTabla>{f.tienda ?? "—"}</CeldaTabla>
                <CeldaTabla>{f.pedidoIdExterno ?? "—"}</CeldaTabla>
                <CeldaTabla>
                  {f.estado === "por_llegar" && puedeCrear ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                      <form action={recibirDevolucionAction} className={styles.filaForm} style={{ gap: 6 }}>
                        <input type="hidden" name="id" value={f.id} />
                        <select name="condicion" required defaultValue="" className="zx-control" aria-label="¿Llegó bueno o averiado?">
                          <option value="" disabled>
                            ¿Cómo llegó?
                          </option>
                          <option value="bueno">Bueno</option>
                          <option value="averiado">Averiado</option>
                        </select>
                        <select name="bodegaId" defaultValue={principal} className="zx-control" aria-label="Bodega si llegó bueno">
                          {bodegasBuenas.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.nombre}
                            </option>
                          ))}
                        </select>
                        {!f.skuId && (
                          <select name="skuId" required defaultValue="" className="zx-control" aria-label="SKU que volvió">
                            <option value="" disabled>
                              ¿Qué SKU volvió?
                            </option>
                            {skusSimples.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.codigo} — {s.nombre}
                              </option>
                            ))}
                          </select>
                        )}
                        <input name="cantidad" type="number" min={1} step={1} defaultValue={f.cantidad} className="zx-control" style={{ width: 80 }} aria-label="Cantidad que llegó" />
                        <Boton type="submit" chico>
                          Recibir
                        </Boton>
                      </form>
                      {puedeAnular && (
                        <form action={anularDevolucionAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <Boton type="submit" variante="fantasma" chico>
                            Anular
                          </Boton>
                        </form>
                      )}
                    </div>
                  ) : (
                    "—"
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <p className={styles.detalle} style={{ marginTop: 8 }}>
            {filas.length} {filas.length === 1 ? "devolución" : "devoluciones"} · {porLlegar} por llegar. Si llegó bueno, elige la bodega; si llegó averiado, entra sola a «{NOMBRE_BODEGA_AVERIADOS}».
          </p>
        </>
      )}
    </>
  );
}
