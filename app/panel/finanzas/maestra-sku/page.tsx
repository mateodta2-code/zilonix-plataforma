import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { FILTRO_SIN_PROVEEDOR, TAMANO_PAGINA_MAESTRA, alertasMaestra, listarMaestraFiltrada, listarProveedoresParaFiltro } from "@/lib/finanzas/maestra";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "../finanzas.module.css";

type Filtros = { proveedor?: string; q?: string; sinCosto?: string };

function hrefCon(filtros: Filtros, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.proveedor) params.set("proveedor", filtros.proveedor);
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.sinCosto) params.set("sinCosto", filtros.sinCosto);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/finanzas/maestra-sku?${qs}` : "/panel/finanzas/maestra-sku";
}

// Issue #128 (Z-FIN-06) — tabla maestra por SKU: filtro por proveedor
// (lista blanca de terceros de la empresa, en lib/finanzas/maestra.ts),
// búsqueda por SKU o producto y "solo sin costo". Muestra el packing
// efectivo y de dónde sale. Ver exige finanzas.consultar; editar e
// importar, finanzas.modificar.
export default async function MaestraSkuPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  let puedeModificar = false;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const filtros: Filtros = {
    proveedor: normalizarParametro(searchParams.proveedor),
    q: normalizarParametro(searchParams.q),
    sinCosto: normalizarParametro(searchParams.sinCosto) === "1" ? "1" : undefined,
  };
  const [resultado, proveedores, alertas] = await Promise.all([
    listarMaestraFiltrada(empresa.id, {
      proveedor: filtros.proveedor,
      busqueda: filtros.q,
      soloSinCosto: filtros.sinCosto,
      pagina: normalizarParametro(searchParams.pagina),
    }),
    listarProveedoresParaFiltro(empresa.id),
    alertasMaestra(empresa.id),
  ]);
  const aplicados: Filtros = { proveedor: resultado.filtroAplicado.proveedor, q: resultado.filtroAplicado.busqueda, sinCosto: filtros.sinCosto };
  const hayFiltros = Boolean(aplicados.proveedor || aplicados.q || aplicados.sinCosto);
  const ok = normalizarParametro(searchParams.ok);
  const totalAlertas = alertas.sinCosto.total + alertas.publicadosFueraDeMaestra.total + alertas.publicacionesSinSku;

  return (
    <>
      <EncabezadoPagina
        titulo="Tabla maestra de SKU"
        descripcion="Costo, packing, envío agencia y precios mínimos por SKU. Un SKU sin costo deja sus ventas fuera de la utilidad."
        accion={
          puedeModificar && (
            <div className={styles.accionesFiltro}>
              <BotonLink href="/panel/finanzas/maestra-sku/importar" chico>
                Cargar Excel o CSV
              </BotonLink>
              <BotonLink href="/panel/finanzas/maestra-sku/editar" variante="secundario" chico>
                Nuevo SKU
              </BotonLink>
            </div>
          )
        }
      />

      {ok && <p className={styles.avisoExito}>{ok}</p>}
      {totalAlertas > 0 && (
        <p className={styles.avisoError}>
          {alertas.sinCosto.total} SKU sin costo · {alertas.publicadosFueraDeMaestra.total} SKU publicados fuera de la maestra ·{" "}
          {alertas.publicacionesSinSku} publicaciones sin SKU.{" "}
          <Link href="/panel/finanzas/maestra-sku/alertas" className={styles.enlace}>
            Ver detalle
          </Link>
        </p>
      )}

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Proveedor">
          <select name="proveedor" defaultValue={aplicados.proveedor ?? ""} className="zx-control">
            <option value="">Todos</option>
            <option value={FILTRO_SIN_PROVEEDOR}>Sin proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.activo ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Buscar">
          <input type="search" name="q" defaultValue={aplicados.q ?? ""} placeholder="SKU o producto" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <label className={styles.casilla}>
          <input type="checkbox" name="sinCosto" value="1" defaultChecked={Boolean(aplicados.sinCosto)} /> Solo sin costo
        </label>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltros && (
            <BotonLink href="/panel/finanzas/maestra-sku" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.total === 0 ? (
        <EstadoVacio>{hayFiltros ? "Ningún SKU coincide con los filtros." : "La tabla maestra está vacía. Cárgala desde Excel o CSV."}</EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["SKU", "Producto", "Proveedor", "Costo", "Packing", "Envío agencia", "Mín. x1", "Mín. x2", "Mín. x3", ""]}>
            {resultado.filas.map((f) => (
              <FilaTabla key={f.id}>
                <CeldaTabla>
                  <strong>{f.skuCodigo}</strong>
                </CeldaTabla>
                <CeldaTabla>{f.nombreProducto ?? "—"}</CeldaTabla>
                <CeldaTabla>{f.proveedorNombre ?? <span className={styles.suave}>Sin proveedor</span>}</CeldaTabla>
                <CeldaTabla>{f.costo === null ? <Chip estado="peligro">Sin costo</Chip> : mostrarMonto(f.costo)}</CeldaTabla>
                <CeldaTabla>
                  {f.packing.sinDato ? (
                    <Chip estado="aviso">Sin dato</Chip>
                  ) : (
                    <>
                      {mostrarMonto(f.packing.valor)}
                      <br />
                      <span className={styles.suave}>{f.packing.origen === "sku" ? "propio del SKU" : "del proveedor"}</span>
                    </>
                  )}
                </CeldaTabla>
                <CeldaTabla>{mostrarMonto(f.envioAgencia)}</CeldaTabla>
                <CeldaTabla>{mostrarMonto(f.precioMinimoUnidad)}</CeldaTabla>
                <CeldaTabla>{mostrarMonto(f.precioMinimoComboX2)}</CeldaTabla>
                <CeldaTabla>{mostrarMonto(f.precioMinimoComboX3)}</CeldaTabla>
                <CeldaTabla>
                  {puedeModificar && (
                    <BotonLink href={`/panel/finanzas/maestra-sku/editar?sku=${encodeURIComponent(f.skuCodigo)}`} variante="fantasma" chico>
                      Editar
                    </BotonLink>
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <div className={styles.paginacion}>
            <span className={styles.suave}>
              {(resultado.pagina - 1) * TAMANO_PAGINA_MAESTRA + 1}–{Math.min(resultado.pagina * TAMANO_PAGINA_MAESTRA, resultado.total)} de {resultado.total}
            </span>
            <div className={styles.accionesFiltro}>
              {resultado.pagina > 1 && (
                <BotonLink href={hrefCon(aplicados, resultado.pagina - 1)} variante="fantasma" chico>
                  Anterior
                </BotonLink>
              )}
              {resultado.pagina < resultado.totalPaginas && (
                <BotonLink href={hrefCon(aplicados, resultado.pagina + 1)} variante="fantasma" chico>
                  Siguiente
                </BotonLink>
              )}
            </div>
          </div>
        </>
      )}

      <div className={styles.accionesFiltro}>
        <BotonLink href="/panel/finanzas/proveedores" variante="fantasma" chico className={styles.volver}>
          Proveedores
        </BotonLink>
        <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
          Volver a Finanzas
        </BotonLink>
      </div>
    </>
  );
}
