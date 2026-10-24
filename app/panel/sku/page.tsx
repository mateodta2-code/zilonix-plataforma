import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { listarPublicacionesSinSku, listarSkusFiltrados, TIPOS_SKU_FILTRO } from "@/lib/ml/sku";
import { crearSkuAction } from "./actions";
import { Boton, BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

type FiltrosNormalizados = { q?: string; estado?: string; orden?: string };

const TAMANO_PAGINA_SKU = 25;

// "Anterior"/"Siguiente" preservan el resto de los filtros de la URL y
// solo cambian ?pagina= — mismo criterio que /panel/pedidos.
function hrefConPagina(filtros: FiltrosNormalizados, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.orden) params.set("orden", filtros.orden);
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return qs ? `/panel/sku?${qs}` : "/panel/sku";
}

// Tarea 2.6 / issue "tabla completa de SKU" — "variantes" son SKUs
// propios agrupados por nombreBase, no una tabla aparte (ver
// db/schema.ts). Búsqueda, filtro por tipo (Kit/Simple — el único
// campo categórico real de la tabla), orden y paginación de 25, todo
// validado en lib/ml/sku.ts con lib/filtros-listado.ts (compartido con
// Pedidos/Despachos) — esta página solo lee la URL y pinta el
// resultado.
export default async function SkuPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const filtros: FiltrosNormalizados = {
    q: normalizarParametro(searchParams.q),
    estado: normalizarParametro(searchParams.estado),
    orden: normalizarParametro(searchParams.orden),
  };
  const [resultado, publicacionesSinSku] = await Promise.all([
    listarSkusFiltrados(empresa.id, { busqueda: filtros.q, estado: filtros.estado, orden: filtros.orden, pagina: normalizarParametro(searchParams.pagina) }),
    listarPublicacionesSinSku(empresa.id),
  ]);

  // Un ?q= que queda vacío después de trim no cuenta como filtro: si
  // no, con cero SKUs reales la pantalla diría "ninguno coincide" en
  // vez de "todavía no has creado ningún SKU".
  const hayFiltrosActivos = Boolean(normalizarTextoBusqueda(filtros.q) || filtros.estado || filtros.orden);
  const desdeFila = (resultado.pagina - 1) * TAMANO_PAGINA_SKU + 1;
  const hastaFila = Math.min(resultado.pagina * TAMANO_PAGINA_SKU, resultado.total);

  return (
    <>
      <EncabezadoPagina
        titulo="SKU"
        accion={
          <BotonLink href="/panel/publicar" variante="secundario" chico>
            Publicar en Mercado Libre
          </BotonLink>
        }
      />

      {publicacionesSinSku.length > 0 && (
        <div className={styles.avisoSinVincular}>
          {publicacionesSinSku.length} publicación(es) sin SKU todavía.{" "}
          <Link href="/panel/sku/sin-vincular" className={styles.enlaceAviso}>
            Enlazarlas
          </Link>
        </div>
      )}

      <Tarjeta>
        <form action={crearSkuAction} className={styles.form}>
          <Campo etiqueta="Código">
            <input name="codigo" id="sku-codigo" required className="zx-control" />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" id="sku-nombre" required className="zx-control" />
          </Campo>
          <Campo etiqueta='Producto base (opcional — agrupa variantes, ej. "Camiseta")'>
            <input name="nombreBase" id="sku-nombre-base" className="zx-control" />
          </Campo>
          <Boton type="submit" className={styles.botonCrear}>
            Crear SKU
          </Boton>
        </form>
      </Tarjeta>

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Buscar">
          {/* Solo código o nombre: los únicos campos de texto libre
              reales de la tabla skus. */}
          <input type="search" name="q" defaultValue={filtros.q ?? ""} placeholder="Código o nombre" className={`zx-control ${styles.campoBusqueda}`} />
        </Campo>
        <Campo etiqueta="Tipo">
          <select name="estado" defaultValue={filtros.estado ?? ""} className="zx-control">
            <option value="">Todos</option>
            {TIPOS_SKU_FILTRO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Ordenar por">
          <select name="orden" defaultValue={filtros.orden ?? "codigo_asc"} className="zx-control">
            <option value="codigo_asc">Código (A-Z)</option>
            <option value="codigo_desc">Código (Z-A)</option>
            <option value="nombre_asc">Nombre (A-Z)</option>
            <option value="nombre_desc">Nombre (Z-A)</option>
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltrosActivos && (
            <BotonLink href="/panel/sku" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {resultado.total === 0 ? (
        <EstadoVacio>
          {hayFiltrosActivos ? (
            <span className={styles.vacioConAccion}>
              Ningún SKU coincide con esos filtros.
              <BotonLink href="/panel/sku" variante="secundario" chico>
                Limpiar filtros
              </BotonLink>
            </span>
          ) : (
            "Todavía no has creado ningún SKU."
          )}
        </EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={["Código", "Nombre", "Tipo"]}>
            {resultado.skus.map((sku) => (
              <FilaTabla key={sku.id}>
                <CeldaTabla>
                  <strong>{sku.codigo}</strong>
                </CeldaTabla>
                <CeldaTabla>
                  {sku.nombre}
                  {sku.nombreBase && <span className={styles.detalleSku}> ({sku.nombreBase})</span>}
                </CeldaTabla>
                <CeldaTabla>{sku.esKit ? <Chip>Kit</Chip> : <Chip estado="neutro">Simple</Chip>}</CeldaTabla>
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

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
