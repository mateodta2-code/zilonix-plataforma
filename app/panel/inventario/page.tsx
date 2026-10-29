import { randomUUID } from "crypto";
import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { instruccionAlerta, listarAlertasPendientes } from "@/lib/inventario/alertas";
import { leerConfiguracionInventario } from "@/lib/inventario/configuracion";
import { cantidadAPublicar } from "@/lib/inventario/calculos";
import { listarInventario, listarSkusConStock, TAMANO_PAGINA_INVENTARIO } from "@/lib/inventario/stock";
import { ajustarStockAction, resolverAlertaAction, trasladarStockAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import styles from "./inventario.module.css";

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
  const q = normalizarParametro(searchParams.q);

  const [resultado, lista, alertas, config, skusSimples] = await Promise.all([
    listarInventario(activa.id, { busqueda: q, pagina: parsearPagina(normalizarParametro(searchParams.pagina)) }),
    listarBodegas(activa.id),
    listarAlertasPendientes(activa.id),
    leerConfiguracionInventario(activa.id),
    puedeMover ? listarSkusConStock(activa.id) : Promise.resolve([]),
  ]);
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
        descripcion={`Stock por bodega. "Para ML" es lo que se publica: disponible de las bodegas que suman, menos un colchón de ${config.bufferMl}.`}
      />
      <SeccionesInventario actual="/panel/inventario" />
      <AvisosUrl searchParams={searchParams} />

      {alertas.length > 0 && (
        <div className={styles.banner}>
          {alertas.map((a) => (
            <div key={a.id} className={styles.alerta}>
              <span>
                <strong>Última unidad · {a.codigo}</strong> ({a.nombre}): quedan {a.disponibleAlCrear} para publicar. {instruccionAlerta(a.regla)}
              </span>
              {puedeMover && (
                <form action={resolverAlertaAction} className={styles.accionesAlerta}>
                  <input type="hidden" name="alertaId" value={a.id} />
                  <Boton type="submit" name="decision" value="aplicar" chico>
                    Aplicar
                  </Boton>
                  <Boton type="submit" name="decision" value="no_aplicar" variante="secundario" chico>
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
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {q && (
            <BotonLink href="/panel/inventario" variante="fantasma" chico>
              Limpiar
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.total === 0 ? (
        <EstadoVacio>{q ? "Ningún SKU coincide con esa búsqueda." : "Todavía no hay SKU. Créalos en la pantalla de SKU."}</EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["SKU", ...columnas.map((b) => b.nombre), "Reservado", "Para ML", "Kardex"]}>
            {resultado.filas.map((f) => (
              <FilaTabla key={f.skuId}>
                <CeldaTabla>
                  <strong>{f.codigo}</strong> {f.esKit && <Chip>Kit</Chip>}
                  <div className={styles.detalle}>{f.nombre}</div>
                </CeldaTabla>
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
                <CeldaTabla>
                  {!f.esKit && (
                    <Link href={`/panel/inventario/kardex?sku=${f.skuId}`} className={styles.enlaceAviso}>
                      Ver
                    </Link>
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Página {resultado.pagina} de {resultado.totalPaginas} · {resultado.total} SKU · {TAMANO_PAGINA_INVENTARIO} por página
            </p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 && (
                <BotonLink href={hrefPagina(resultado.pagina - 1)} chico>
                  Anterior
                </BotonLink>
              )}
              {resultado.pagina < resultado.totalPaginas && (
                <BotonLink href={hrefPagina(resultado.pagina + 1)} chico>
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
