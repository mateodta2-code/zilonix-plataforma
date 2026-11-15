import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { listarPublicacionesSinSkuFiltradas, listarSkus } from "@/lib/ml/sku";
import { vincularAction } from "./actions";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

type FiltrosNormalizados = { q?: string; orden?: string };

const TAMANO_PAGINA_SIN_VINCULAR = 25;

// "Anterior"/"Siguiente" preservan el resto de los filtros de la URL y
// solo cambian ?pagina= — mismo criterio que /panel/pedidos.
function hrefConPagina(filtros: FiltrosNormalizados, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.orden) params.set("orden", filtros.orden);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/sku/sin-vincular?${qs}` : "/panel/sku/sin-vincular";
}

// Tarea 2.6 / issue "tabla completa de SKU" — pantalla que pide el
// criterio de "listo": "ninguna publicación de Mateo queda sin SKU".
// Búsqueda por título o por el id de publicación de Mercado Libre,
// orden y paginación de 25 — sin filtro de estado: publicaciones no
// tiene ningún campo categórico real aparte de skuId (que acá siempre
// es null, por definición de esta pantalla). El <select> de "Elegir
// SKU…" sigue usando listarSkus() completo (sin paginar): necesita
// TODO el catálogo para elegir, no una página de 25.
export default async function PublicacionesSinSkuPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return (
      <SinAcceso mensaje={`Tu rol (${(await obtenerMiMembresia(usuario.id, empresa.id))?.rolNombre ?? "sin rol"}) no puede enlazar SKUs.`} volverHref="/panel/sku" volverTexto="Volver" />
    );
  }

  const filtros: FiltrosNormalizados = {
    q: normalizarParametro(searchParams.q),
    orden: normalizarParametro(searchParams.orden),
  };
  const [resultado, skus] = await Promise.all([
    listarPublicacionesSinSkuFiltradas(empresa.id, { busqueda: filtros.q, orden: filtros.orden, pagina: normalizarParametro(searchParams.pagina) }),
    listarSkus(empresa.id),
  ]);

  const hayFiltrosActivos = Boolean(normalizarTextoBusqueda(filtros.q) || filtros.orden);
  const desdeFila = (resultado.pagina - 1) * TAMANO_PAGINA_SIN_VINCULAR + 1;
  const hastaFila = Math.min(resultado.pagina * TAMANO_PAGINA_SIN_VINCULAR, resultado.total);

  return (
    <>
      <EncabezadoPagina titulo="Publicaciones sin SKU" />

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Buscar">
          <input
            type="search"
            name="q"
            defaultValue={filtros.q ?? ""}
            placeholder="Título o id de publicación"
            className={`zx-control ${styles.campoBusqueda}`}
          />
        </Campo>
        <Campo etiqueta="Ordenar por">
          <select name="orden" defaultValue={filtros.orden ?? "importado_desc"} className="zx-control">
            <option value="importado_desc">Más recientes primero</option>
            <option value="importado_asc">Más antiguas primero</option>
            <option value="titulo_asc">Título (A-Z)</option>
            <option value="titulo_desc">Título (Z-A)</option>
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltrosActivos && (
            <BotonLink href="/panel/sku/sin-vincular" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.total === 0 ? (
        <EstadoVacio>
          {hayFiltrosActivos ? (
            <span className={styles.vacioConAccion}>
              Ninguna publicación coincide con esos filtros.
              <BotonLink href="/panel/sku/sin-vincular" variante="secundario" chico>
                Limpiar filtros
              </BotonLink>
            </span>
          ) : (
            "Todas las publicaciones ya tienen un SKU enlazado."
          )}
        </EstadoVacio>
      ) : skus.length === 0 ? (
        <EstadoVacio>
          Todavía no has creado ningún SKU — <Link href="/panel/sku">créalos acá primero</Link>.
        </EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["Publicación", "Precio", "Stock", ""]}>
            {resultado.publicaciones.map((publicacion) => (
              <FilaTabla key={publicacion.id}>
                <CeldaTabla>
                  {publicacion.titulo}
                  <span className={styles.idExterno}> · #{publicacion.publicacionIdExterno}</span>
                </CeldaTabla>
                <CeldaTabla>${publicacion.precio}</CeldaTabla>
                <CeldaTabla>{publicacion.stock}</CeldaTabla>
                <CeldaTabla>
                  <form action={vincularAction} className={styles.form}>
                    <input type="hidden" name="publicacionId" value={publicacion.id} />
                    <select name="skuId" required className={`zx-control ${styles.select}`}>
                      <option value="">Elegir SKU…</option>
                      {skus.map((sku) => (
                        <option key={sku.id} value={sku.id}>
                          {sku.codigo} — {sku.nombre}
                        </option>
                      ))}
                    </select>
                    <Boton type="submit" chico>
                      Enlazar
                    </Boton>
                  </form>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>

          <div className={styles.paginacion}>
            <p className={styles.resumenPaginacion}>
              Mostrando {desdeFila}–{hastaFila} de {resultado.total}
            </p>
            <div className={styles.botonesPaginacion}>
              {resultado.pagina > 1 ? (
                <BotonLink href={hrefConPagina(filtros, resultado.pagina - 1)} variante="secundario" chico>
                  Anterior
                </BotonLink>
              ) : (
                <span className={clasesBoton("secundario", true)} aria-disabled="true">
                  Anterior
                </span>
              )}
              {resultado.pagina < resultado.totalPaginas ? (
                <BotonLink href={hrefConPagina(filtros, resultado.pagina + 1)} variante="secundario" chico>
                  Siguiente
                </BotonLink>
              ) : (
                <span className={clasesBoton("secundario", true)} aria-disabled="true">
                  Siguiente
                </span>
              )}
            </div>
          </div>
        </>
      )}

      <BotonLink href="/panel/sku" variante="fantasma" chico className={styles.volver}>
        Volver a SKU
      </BotonLink>
    </>
  );
}
