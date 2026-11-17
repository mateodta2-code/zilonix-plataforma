import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlNoDisponibleError, MlSinPermisoAppError } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente, obtenerSitioDeCuenta } from "@/lib/ml/cuentas";
import { etiquetaTipoPublicacion, hrefOptimizacion, leerFiltroOptimizacion, TAMANO_PAGINA_OPTIMIZACION } from "@/lib/ml/optimizacion";
import {
  cargarCalidad,
  cargarCompetencia,
  cargarListaBase,
  cargarPreciosPromocion,
  cargarVentasDeFilas,
  cargarVisitas,
  type ListaBase,
} from "@/lib/ml/optimizacion-datos";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import {
  CeldaCalidadAsync,
  CeldaCompetenciaAsync,
  CeldaConversionAsync,
  CeldaPrecioAsync,
  CeldaVentasAsync,
  CeldaVisitasAsync,
} from "./Celdas";
import { FilaOptimizacion } from "./FilaOptimizacion";
import styles from "./page.module.css";
import { ProveedorToastOptimizacion } from "./ToastOptimizacion";

type Param = string | string[] | undefined;

const ENCABEZADOS: (string | EncabezadoTabla)[] = [
  "Publicación",
  { clave: "precio", contenido: "Precio", numerica: true },
  "Tipo",
  "Envío",
  { clave: "visitas", contenido: "Visitas 7 d", numerica: true },
  { clave: "ventas", contenido: "Ventas 7 d", numerica: true },
  { clave: "conversion", contenido: "Conversión", numerica: true },
  "Calidad",
  "Competencia",
  "Estado",
  "Acción",
  { clave: "desglose", contenido: "" },
];

function mensajeDeError(error: unknown): string | null {
  if (error instanceof LimiteMercadoLibreError) return "Mercado Libre está limitando las consultas. Intenta de nuevo en un minuto.";
  if (error instanceof MlNoAutorizadoError) return "La conexión con esta cuenta de Mercado Libre ya no es válida: hay que reconectarla.";
  if (error instanceof MlSinPermisoAppError) return "Mercado Libre no le da permiso a Zilonix para esta consulta.";
  if (error instanceof MlNoDisponibleError) return "Mercado Libre no respondió a tiempo. Intenta de nuevo en un momento.";
  return null;
}

// Módulo Optimización, Parte 1 — listado de publicaciones de UNA cuenta
// con métricas por fila. Solo lectura; pausar/activar vive en actions.ts
// y pide "inventario","modificar".
export default async function OptimizacionPage({ searchParams }: { searchParams?: { cuenta?: Param; estado?: Param; q?: Param; pagina?: Param } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Optimización" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeModificar = miMembresia ? tienePermiso(miMembresia.permisos, "inventario", "modificar") : false;
  const filtro = leerFiltroOptimizacion({ estado: searchParams?.estado, q: searchParams?.q, pagina: searchParams?.pagina });

  const conectadas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const { cuentas, cuentaId: elegida } = await leerCuentaMlDeQuery(empresa.id, searchParams?.cuenta);
  // Las publicaciones son de UNA cuenta: con una sola conectada se usa esa;
  // con varias hay que elegirla ("Todas" no aplica).
  const cuenta = conectadas.find((c) => c.id === elegida) ?? (conectadas.length === 1 && !elegida ? conectadas[0] : null);

  const encabezado = <EncabezadoPagina titulo="Optimización" descripcion="Publicaciones activas y pausadas con sus métricas de los últimos 7 días." />;

  if (conectadas.length === 0) {
    return (
      <>
        {encabezado}
        <EstadoVacio>
          No hay cuentas de Mercado Libre conectadas.{" "}
          <BotonLink href="/panel/conectar-ml" chico>
            Conectar Mercado Libre
          </BotonLink>
        </EstadoVacio>
      </>
    );
  }

  const selector =
    cuentas.length > 1 ? (
      <SelectorCuentaMl empresaId={empresa.id} cuenta={searchParams?.cuenta} parametros={{ ...(filtro.estado !== "todas" ? { estado: filtro.estado } : {}), ...(filtro.q ? { q: filtro.q } : {}) }} />
    ) : null;

  if (!cuenta) {
    return (
      <>
        {encabezado}
        <div className={styles.bloque}>
          {selector}
          <EstadoVacio>Elige una cuenta de Mercado Libre para ver sus publicaciones.</EstadoVacio>
        </div>
      </>
    );
  }

  const avisoVacio = (texto: React.ReactNode) => (
    <>
      {encabezado}
      <div className={styles.bloque}>
        {selector}
        <EstadoVacio>{texto}</EstadoVacio>
      </div>
    </>
  );

  let token: string;
  let sitio: Awaited<ReturnType<typeof obtenerSitioDeCuenta>>;
  let lista: ListaBase;
  try {
    token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
    sitio = await obtenerSitioDeCuenta(empresa.id, cuenta.id);
    lista = await cargarListaBase({ id: cuenta.id, cuentaIdExterna: cuenta.cuentaIdExterna }, token, filtro);
  } catch (error) {
    const mensaje = mensajeDeError(error);
    if (mensaje) return avisoVacio(mensaje);
    // Cuenta desconectada, token que no se pudo renovar, etc.: mensaje propio
    // del error + camino para reconectar.
    return avisoVacio(
      <>
        {error instanceof Error ? error.message : "No se pudieron leer las publicaciones."}{" "}
        <BotonLink href="/panel/conectar-ml" chico>
          Revisar conexión
        </BotonLink>
      </>
    );
  }

  // Métricas SOLO de la página visible (máx. 50), sin esperarlas aquí: la
  // lista ya sale y cada celda se llena cuando su promesa termina. Ninguna
  // de estas promesas rechaza (cada fallo queda como "No disponible").
  const ids = lista.filas.map((f) => f.itemId);
  const visitasP = cargarVisitas(ids, token);
  const promosP = cargarPreciosPromocion(ids, token);
  const calidadP = cargarCalidad(ids, token);
  const competenciaP = cargarCompetencia(lista.filas, sitio.siteId, token);
  const ventasP = cargarVentasDeFilas(empresa.id, { id: cuenta.id, cuentaIdExterna: cuenta.cuentaIdExterna }, token);

  const base = { cuenta: elegida, filtro };
  const totalPaginas = Math.max(1, Math.ceil(lista.total / TAMANO_PAGINA_OPTIMIZACION));

  return (
    <>
      {encabezado}
      <div className={styles.bloque}>
        {selector}
        <form method="get" action="/panel/optimizacion" className={styles.buscador}>
          {elegida ? <input type="hidden" name="cuenta" value={elegida} /> : null}
          <input type="search" name="q" defaultValue={filtro.q} placeholder="Buscar por título, ID o SKU" aria-label="Buscar publicaciones" maxLength={80} />
          <select name="estado" defaultValue={filtro.estado} aria-label="Filtrar por estado">
            <option value="todas">Activas y pausadas</option>
            <option value="active">Solo activas</option>
            <option value="paused">Solo pausadas</option>
          </select>
          <Boton type="submit">Buscar</Boton>
        </form>

        {lista.filas.length === 0 ? (
          <EstadoVacio>{filtro.q ? "Ninguna publicación coincide con la búsqueda." : "Esta cuenta no tiene publicaciones en ese estado."}</EstadoVacio>
        ) : (
          <Tarjeta>
            <ProveedorToastOptimizacion>
              <Tabla encabezados={ENCABEZADOS}>
                {lista.filas.map((f) => (
                  <FilaOptimizacion
                    key={f.itemId}
                    cuentaId={cuenta.id}
                    itemId={f.itemId}
                    titulo={f.titulo ?? f.itemId}
                    thumbnail={f.thumbnail}
                    permalink={f.permalink}
                    sku={f.sku}
                    tipo={etiquetaTipoPublicacion(f.listingTypeId)}
                    envioGratis={f.envioGratis}
                    esFull={f.esFull}
                    status={f.status}
                    subStatus={f.subStatus}
                    puedeModificar={puedeModificar}
                    precio={<CeldaPrecioAsync promesa={promosP} itemId={f.itemId} precioBase={f.precio} sitio={sitio} />}
                    visitas={<CeldaVisitasAsync promesa={visitasP} itemId={f.itemId} sitio={sitio} />}
                    ventas={<CeldaVentasAsync promesa={ventasP} itemId={f.itemId} sitio={sitio} />}
                    conversion={<CeldaConversionAsync visitasP={visitasP} ventasP={ventasP} itemId={f.itemId} sitio={sitio} />}
                    calidad={<CeldaCalidadAsync promesa={calidadP} itemId={f.itemId} />}
                    competencia={<CeldaCompetenciaAsync promesa={competenciaP} itemId={f.itemId} />}
                  />
                ))}
              </Tabla>
            </ProveedorToastOptimizacion>
          </Tarjeta>
        )}

        <div className={styles.paginacion}>
          <span>
            {lista.total} publicaciones · página {filtro.pagina} de {totalPaginas}
          </span>
          <span>
            {filtro.pagina > 1 ? <Link href={hrefOptimizacion(base, { pagina: filtro.pagina - 1 })}>← Anterior</Link> : null}
            {filtro.pagina > 1 && filtro.pagina < totalPaginas ? " · " : null}
            {filtro.pagina < totalPaginas ? <Link href={hrefOptimizacion(base, { pagina: filtro.pagina + 1 })}>Siguiente →</Link> : null}
          </span>
        </div>
      </div>
    </>
  );
}
