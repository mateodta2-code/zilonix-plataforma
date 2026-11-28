import { randomUUID } from "crypto";
import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro, LARGO_MAXIMO_BUSQUEDA } from "@/lib/filtros-listado";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { CANTIDAD_INICIAL_MAXIMA } from "@/lib/importar-csv-skus";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { fechaCreacionBogota, LARGO_MAXIMO_CODIGO, LARGO_MAXIMO_NOMBRE, listarSkusCreados, obtenerSkuParaEditar } from "@/lib/inventario/crear-producto";
import { crearProductoAction, editarProductoAction } from "./actions";
import { BotonSkuAleatorio } from "./BotonSkuAleatorio";
import { CargaMasivaClient } from "./CargaMasivaClient";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl } from "@/components/inventario/Avisos";
import styles from "./page.module.css";

const RUTA = "/panel/sku/crear";

// Issue #280 — «Crear producto (SKU)». Ver pide inventario.consultar;
// crear (formulario y carga masiva), inventario.crear; editar,
// inventario.modificar (también en cada acción).
export default async function CrearProductoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  const puedeModificar = tienePermiso(permisos, "inventario", "modificar");

  const q = (normalizarParametro(searchParams.q) ?? "").slice(0, LARGO_MAXIMO_BUSQUEDA);
  const editarId = normalizarParametro(searchParams.editar) ?? "";
  const [bodegas, lista, enEdicion] = await Promise.all([
    puedeCrear ? listarBodegas(activa.id, { soloActivas: true }) : Promise.resolve([]),
    listarSkusCreados(activa.id, { q, pagina: normalizarParametro(searchParams.pagina) }),
    puedeModificar && editarId ? obtenerSkuParaEditar(activa.id, editarId) : Promise.resolve(null),
  ]);
  const principal = bodegas.find((b) => b.esPrincipal)?.id ?? bodegas[0]?.id ?? "";
  const enlacePagina = (pagina: number) => `${RUTA}?${new URLSearchParams({ ...(q ? { q } : {}), pagina: String(pagina) }).toString()}`;

  return (
    <>
      <EncabezadoPagina
        titulo="Crear producto (SKU)"
        descripcion="Crea un producto con su SKU, costo, precio y stock inicial. El stock inicial entra al kardex como «Inventario inicial»."
      />
      <AvisosUrl searchParams={searchParams} />

      {enEdicion && (
        <Tarjeta className={styles.tarjeta}>
          <h2 className={styles.tituloSeccion}>Editar {enEdicion.codigo}</h2>
          {enEdicion.esKit ? (
            <p className={styles.detalle}>
              Los kits se administran en <Link href="/panel/sku" className={styles.enlace}>SKU</Link>.
            </p>
          ) : (
            <form action={editarProductoAction} className={styles.pila}>
              <input type="hidden" name="skuId" value={enEdicion.id} />
              <div className={styles.filaForm}>
                <Campo etiqueta="Nombre">
                  <input name="nombre" required maxLength={LARGO_MAXIMO_NOMBRE} defaultValue={enEdicion.nombre} className="zx-control" />
                </Campo>
                <Campo etiqueta="Código (SKU)">
                  {enEdicion.tieneMovimientos ? (
                    <input value={enEdicion.codigo} disabled className="zx-control" aria-describedby="codigo-bloqueado" readOnly />
                  ) : (
                    <input name="codigo" required maxLength={LARGO_MAXIMO_CODIGO} defaultValue={enEdicion.codigo} className="zx-control" />
                  )}
                </Campo>
              </div>
              {enEdicion.tieneMovimientos && (
                <p id="codigo-bloqueado" className={styles.detalle}>
                  El código ya no se puede cambiar porque este SKU tiene movimientos de inventario. El nombre sí.
                </p>
              )}
              <div className={styles.acciones}>
                <Boton type="submit">Guardar cambios</Boton>
                <BotonLink href={RUTA} variante="fantasma">
                  Cancelar
                </BotonLink>
              </div>
            </form>
          )}
        </Tarjeta>
      )}

      {!puedeCrear ? (
        <p className={styles.detalle}>Tu rol puede ver los SKU, pero no crearlos.</p>
      ) : (
        <div className={styles.columnas}>
          <Tarjeta className={styles.tarjeta}>
            <h2 className={styles.tituloSeccion}>Crear producto</h2>
            <form action={crearProductoAction} className={styles.pila}>
              <input type="hidden" name="operacionId" value={randomUUID()} />
              <Campo etiqueta="Nombre">
                <input name="nombre" required maxLength={LARGO_MAXIMO_NOMBRE} placeholder="Linterna recargable" className="zx-control" />
              </Campo>
              <Campo etiqueta="SKU (vacío = se genera)">
                <div className={styles.campoSku}>
                  <input name="sku" maxLength={LARGO_MAXIMO_CODIGO} placeholder="FULLIN0001 o tu propio código" className="zx-control" />
                  <BotonSkuAleatorio />
                </div>
              </Campo>
              <div className={styles.filaForm}>
                <Campo etiqueta="Costo inicial">
                  <input name="costo" inputMode="decimal" placeholder="5.000" className="zx-control" />
                </Campo>
                <Campo etiqueta="Precio de venta">
                  <input name="precioVenta" inputMode="decimal" placeholder="12.900" className="zx-control" />
                </Campo>
              </div>
              <div className={styles.filaForm}>
                <Campo etiqueta="Stock inicial">
                  <input name="stockInicial" type="number" min={0} max={CANTIDAD_INICIAL_MAXIMA} step={1} defaultValue={0} className="zx-control" />
                </Campo>
                <Campo etiqueta="Bodega">
                  {bodegas.length === 0 ? (
                    <span className={styles.detalle}>
                      Crea una bodega primero en <Link href="/panel/bodegas" className={styles.enlace}>/panel/bodegas</Link>
                    </span>
                  ) : (
                    <select name="bodegaId" className="zx-control" defaultValue={principal}>
                      {bodegas.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nombre}
                          {b.esPrincipal ? " (principal)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
              </div>
              <p className={styles.detalle}>La bodega solo se usa si el stock inicial es mayor que 0. Costo y precio vacíos = sin dato; 0 = cero real.</p>
              <div className={styles.acciones}>
                <Boton type="submit">Crear producto</Boton>
              </div>
            </form>
          </Tarjeta>

          <Tarjeta className={styles.tarjeta}>
            <h2 className={styles.tituloSeccion}>Carga masiva</h2>
            <CargaMasivaClient bodegas={bodegas.map((b) => ({ id: b.id, nombre: b.nombre, esPrincipal: b.esPrincipal }))} />
          </Tarjeta>
        </div>
      )}

      <h2 className={styles.tituloSeccion}>SKUs creados</h2>
      <form method="get" action={RUTA} className={styles.filtros}>
        <Campo etiqueta="Buscar por código o nombre">
          <input name="q" defaultValue={q} maxLength={LARGO_MAXIMO_BUSQUEDA} className="zx-control" />
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" variante="secundario">
            Buscar
          </Boton>
          {q && (
            <BotonLink href={RUTA} variante="fantasma">
              Limpiar
            </BotonLink>
          )}
        </div>
      </form>

      {lista.filas.length === 0 ? (
        <EstadoVacio>{q ? "Ningún SKU coincide con esa búsqueda." : "Todavía no has creado ningún SKU."}</EstadoVacio>
      ) : (
        <>
          <Tabla
            scroll
            encabezados={[
              "Fecha de creación",
              "Código",
              "Nombre",
              "Tipo",
              { clave: "costo", contenido: "Costo", numerica: true },
              { clave: "precio", contenido: "Precio de venta", numerica: true },
              { clave: "stock", contenido: "Stock total", numerica: true },
              "",
            ]}
          >
            {lista.filas.map((f) => (
              <FilaTabla key={f.id}>
                <CeldaTabla>{fechaCreacionBogota(f.creadoTs)}</CeldaTabla>
                <CeldaTabla>
                  <SkuCopiable sku={f.codigo} />
                </CeldaTabla>
                <CeldaTabla>{f.nombre}</CeldaTabla>
                <CeldaTabla>{f.esKit ? "Kit" : "Simple"}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMonto(f.costo)}</CeldaTabla>
                <CeldaTabla numerica>{mostrarMonto(f.precioVenta)}</CeldaTabla>
                <CeldaTabla numerica>{f.stockTotal === null ? "—" : f.stockTotal.toLocaleString("es-CO")}</CeldaTabla>
                <CeldaTabla>
                  {puedeModificar && (
                    <BotonLink href={`${RUTA}?editar=${f.id}`} variante="secundario" chico>
                      Editar
                    </BotonLink>
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <div className={styles.paginacion}>
            <p className={styles.detalle}>
              {lista.total} SKU · página {lista.pagina} de {Math.max(1, lista.totalPaginas)}
            </p>
            <div className={styles.acciones}>
              {lista.pagina > 1 && (
                <BotonLink href={enlacePagina(lista.pagina - 1)} variante="fantasma" chico>
                  Anterior
                </BotonLink>
              )}
              {lista.pagina < lista.totalPaginas && (
                <BotonLink href={enlacePagina(lista.pagina + 1)} variante="fantasma" chico>
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
