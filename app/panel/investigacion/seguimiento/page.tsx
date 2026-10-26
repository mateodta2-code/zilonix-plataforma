import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import {
  LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA,
  LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA,
  listarAlertasDelDia,
  listarSeguimientosConUltimaFoto,
} from "@/lib/seguimiento/seguimientos";
import { mensajeAlerta, normalizarPublicaciones, obtenerPrecioAproximado, obtenerVendidosAproximado } from "@/lib/seguimiento/alertas";
import { calcularDelta, calcularVentasHoy } from "@/lib/seguimiento/comparativa";
import { necesitaLecturaDePagina } from "@/lib/seguimiento/estimacionInventario";
import { construirLinkMlDeSeguimiento } from "@/lib/seguimiento/link";
import { Ayuda } from "@/components/marco/Ayuda";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { PanelLateral } from "@/components/marco/PanelLateral";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { agregarSeguimientoAction, eliminarSeguimientoAction, marcarAlertaLeidaAction, procesarAgregarPorQuery } from "./actions";
import { BotonActualizarTodo } from "./BotonActualizarTodo";
import { EscuchaExtension } from "./EscuchaExtension";
import styles from "./page.module.css";

// Issue #182 — mismo patrón /^MCO\d+$/ y /^\d+$/ que la extensión usa
// del lado del content script (extension/lectores/mercadolibre.js,
// PATRON_ID_ITEM/PATRON_ID_VENDEDOR) antes de armar el link — se vuelve
// a validar ACÁ porque el query param que llega a esta pantalla nunca
// es confiable solo porque la extensión lo armó bien: cualquiera puede
// pegar la URL a mano con basura.
const PATRON_ID_ITEM = /^MCO\d+$/;
const PATRON_ID_VENDEDOR = /^\d+$/;

function dinero(n: number | string | null): string {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString("es-CO")}`;
}

// Issue #251, punto 7 — "leído de la página el {fecha}".
function fechaLegible(d: Date): string {
  return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function siNoODesconocido(valor: boolean | null, textoSi: string, textoNo: string): React.ReactNode {
  if (valor == null) return <Chip>No disponible</Chip>;
  return valor ? <Chip estado="exito">{textoSi}</Chip> : <Chip estado="peligro">{textoNo}</Chip>;
}

// Issue #195 — "valor + delta" (ej. 9 (−1)) cuando hay foto anterior
// con la que comparar; solo el valor cuando no hay. `formatearValor`
// decide cómo se ve el número entero (dinero() para precio, tal cual
// para inventario/vendidos); el delta usa el mismo formateador, con
// signo explícito agregado acá (nunca "+"/"-" adivinados adentro del
// formateador, que solo sabe mostrar valores absolutos).
function conSigno(n: number, formatearValor: (n: number) => string): string {
  if (n === 0) return formatearValor(0);
  return n > 0 ? `+${formatearValor(n)}` : `-${formatearValor(Math.abs(n))}`;
}

function celdaConDelta(
  actual: number | string | null,
  anterior: number | string | null,
  formatearValor: (n: number) => string
): React.ReactNode {
  if (actual == null) return "—";
  const texto = formatearValor(Number(actual));
  const delta = calcularDelta(actual, anterior);
  if (delta == null) return texto;
  const signo = delta > 0 ? "positivo" : delta < 0 ? "negativo" : "neutro";
  return (
    <>
      {texto} <span className={styles.delta} data-signo={signo}>({conSigno(delta, formatearValor)})</span>
    </>
  );
}

const numeroPlano = (n: number) => n.toLocaleString("es-CO");

// Issue #200 (Sharel) — la tarjeta de abajo solo tenía el "?" chico
// (Ayuda.tsx) y a un cliente no le alcanzaba. Guía más larga, en un
// panel lateral (PanelLateral.tsx, no un tooltip), con las 5 secciones
// que pidió el issue.
function GuiaAgregarSeguimiento() {
  return (
    <>
      <div>
        <h3>1. Elegí el tipo primero</h3>
        <p>
          <strong>Producto:</strong> seguís UNA publicación o un producto de catálogo puntual (precio, inventario, ventas).
        </p>
        <p>
          <strong>Tienda / vendedor:</strong> seguís TODAS las publicaciones de un vendedor — te avisamos cuando sube o baja una.
        </p>
      </div>

      <div>
        <h3>2. Producto: qué pegar</h3>
        <ul>
          <li>
            El link completo de la publicación — se ve así: <code>articulo.mercadolibre.com.co/MCO-123456789-...</code>
          </li>
          <li>
            O el id solo: <code>MCO123456789</code>.
          </li>
        </ul>
        <p>
          <strong>Cómo copiar el link:</strong> con la publicación abierta en Mercado Libre, hacé clic en la barra de direcciones del navegador
          (arriba de todo, donde dice la URL) para seleccionarla completa, copiala (Ctrl+C o Cmd+C) y pegala en el campo de acá.
        </p>
      </div>

      <div>
        <h3>3. Tienda / vendedor: qué pegar</h3>
        <p>Lo más seguro es el número de seller_id solo (nada de letras), pegalo directo. También funcionan links que TRAEN ese número:</p>
        <ul>
          <li>
            <code>...?seller_id=123456...</code>
          </li>
          <li>
            <code>...?CustId=123456...</code>
          </li>
          <li>
            <code>..._CustId_123456...</code>
          </li>
        </ul>
        <p>
          <strong>Aviso:</strong> un link de tienda oficial (<code>mercadolibre.com.co/tienda/nombre</code>) o una página con nickname (
          <code>mercadolibre.com.co/pagina/nombre</code>) SOLOS, sin ninguno de esos parámetros, no alcanzan — Mercado Libre no deja ver el
          seller_id real desde ahí. Seguí el paso 4 para conseguirlo.
        </p>
      </div>

      <div>
        <h3>4. Cómo conseguir el id de un competidor</h3>
        <ol>
          <li>Abrí cualquier publicación de ese vendedor en Mercado Libre.</li>
          <li>Hacé clic en su nombre o en su foto, donde dice &quot;Vendido por...&quot; — se abre la página de esa tienda.</li>
          <li>Copiá el link de la barra de direcciones de ESA página (ahí sí suele traer seller_id= o CustId=) y pegalo acá con tipo &quot;Tienda / vendedor&quot;.</li>
        </ol>
        <p>
          También podés usar la extensión de Chrome de Zilonix: abrí la publicación o la tienda del competidor y hacé clic en &quot;Seguir en
          Zilonix&quot; — agrega el seguimiento sola, sin tener que copiar ni pegar nada.
        </p>
      </div>

      <div>
        <h3>5. &quot;Es competidor&quot;</h3>
        <p>Marcá esta casilla cuando el producto o la tienda es de la competencia, no propio — así lo vas a distinguir en la lista.</p>
        <p>
          <strong>Cupo:</strong> hasta 5 competidores a la vez por empresa. Para agregar un sexto, primero quitá uno de la lista.
        </p>
        <p>
          <strong>Cambiar si es competidor:</strong> no hay un botón de editar — pegá otra vez el MISMO link o id con la casilla en el estado que
          quieras: se actualiza el que ya tenías, nunca se duplica.
        </p>
      </div>
    </>
  );
}

// Issue #175 — pantalla de seguimiento diario de productos, tiendas y
// competidores de Mercado Libre. Mismo permiso que Investigación
// (inventario, consultar) para ver — agregar/quitar pide "modificar"
// (ver actions.ts). Todo el cálculo real (lector, alertas) vive en
// lib/seguimiento/ y lib/trabajos/ — esta pantalla solo lee lo que la
// revisión diaria ya guardó, nunca llama a Mercado Libre en vivo (al
// revés de /panel/investigacion, que sí busca en el momento).
export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    agregado?: string;
    primeraRevisionError?: string;
    eliminado?: string;
    leida?: string;
    yaExistia?: string;
    agregar?: string;
    agregar_tienda?: string;
  };
}) {
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

  // Issue #182 — la extensión (0.3.0, "Seguir en Zilonix") abre esta
  // pantalla con ?agregar=<itemId MCO> o ?agregar_tienda=<sellerId
  // numérico>. Se procesa ANTES de listar y siempre termina en un
  // redirect REPLACE a la misma ruta sin ese query (nunca push — si
  // quedara en el historial, volver atrás y F5 lo dispararía otra
  // vez). El formato se valida acá mismo: un id que no matchea nunca
  // llega a procesarAgregarPorQuery, se avisa "inválido" directo.
  if (typeof searchParams.agregar === "string") {
    if (!PATRON_ID_ITEM.test(searchParams.agregar)) {
      redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent("El link de producto que llegó no es válido.")}`, RedirectType.replace);
    }
    await procesarAgregarPorQuery(empresa.id, usuario.id, { tipo: "producto", mlIdExterno: searchParams.agregar });
  } else if (typeof searchParams.agregar_tienda === "string") {
    if (!PATRON_ID_VENDEDOR.test(searchParams.agregar_tienda)) {
      redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent("El link de tienda que llegó no es válido.")}`, RedirectType.replace);
    }
    await procesarAgregarPorQuery(empresa.id, usuario.id, { tipo: "tienda", mlIdExterno: searchParams.agregar_tienda });
  }

  const [alertasDelDia, seguimientos] = await Promise.all([listarAlertasDelDia(empresa.id), listarSeguimientosConUltimaFoto(empresa.id)]);
  // Issue #251 — dos pozos separados, nunca uno combinado (ver
  // LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA/LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA,
  // lib/seguimiento/seguimientos.ts).
  const tiendasCompetidorActivas = seguimientos.filter((s) => s.seguimiento.esCompetidor && s.seguimiento.tipo === "tienda").length;
  const productosCompetidorActivos = seguimientos.filter((s) => s.seguimiento.esCompetidor && s.seguimiento.tipo === "producto").length;

  // Issue #251, punto 9 — "Actualizar todo": los links reales de cada
  // competidor (nunca más de 10, por el tope 5+5 de arriba) para que
  // el botón los abra con un solo clic real — la extensión lee cada
  // página al cargar, mismo disparador que ya usa "abrir la ficha/
  // tienda seguida". `.slice(0, 10)` acá TAMBIÉN (corrección de
  // Pablo) — defensa en profundidad: BotonActualizarTodo.tsx y
  // background.js (quien de verdad abre las pestañas) vuelven a
  // aplicar su propio tope, cada capa sin confiar en la anterior.
  const ahora = new Date();
  const linksCompetidores = seguimientos
    .filter((s) => s.seguimiento.esCompetidor)
    .map((s) => construirLinkMlDeSeguimiento(s.seguimiento.recursoMl, s.seguimiento.mlIdExterno))
    .slice(0, 10);

  // Issue #195 — chip "Alta/Baja hoy" en la fila de una tienda cuando
  // la revisión diaria ya generó la alerta correspondiente HOY (las
  // alertas en sí ya se ven arriba, en "Alertas de hoy" — esto es solo
  // un aviso rápido en la propia fila, para no tener que buscarla).
  const altasHoy = new Set(alertasDelDia.filter((a) => a.alerta.tipo === "publicacion_nueva").map((a) => a.alerta.seguimientoId));
  const bajasHoy = new Set(alertasDelDia.filter((a) => a.alerta.tipo === "publicacion_eliminada").map((a) => a.alerta.seguimientoId));

  return (
    <>
      {/* Issue #251 — escucha "dato-pagina-seguimiento" (inventario/
      vendidos de un competidor, publicaciones de una tienda seguida,
      leídos de la página abierta con la extensión) y guarda con la
      Server Action correspondiente. Nunca pinta nada por su cuenta. */}
      <EscuchaExtension />
      <EncabezadoPagina
        titulo="Seguimiento"
        descripcion="Seguimiento diario de productos, tiendas y competidores de Mercado Libre — precio, inventario, ventas y alertas cuando algo cambia."
      />

      {searchParams.error ? <EstadoVacio>{searchParams.error}</EstadoVacio> : null}
      {/* Issue #204 — antes decía "la primera foto llega con la
      próxima revisión diaria" (hasta una hora, el cron corre cada
      hora): ahora la primera revisión corre en el mismo momento de
      agregar, la fila de abajo ya debería traer datos reales. */}
      {searchParams.agregado && !searchParams.primeraRevisionError ? (
        <p className={styles.aviso}>Seguimiento agregado — ya se revisó con Mercado Libre, la fila de abajo trae los datos reales.</p>
      ) : null}
      {searchParams.primeraRevisionError ? (
        <p className={styles.aviso}>
          Seguimiento agregado, pero la primera revisión con Mercado Libre falló ({searchParams.primeraRevisionError}) — se va a reintentar solo
          en la próxima revisión diaria.
        </p>
      ) : null}
      {searchParams.yaExistia ? <p className={styles.aviso}>Ese producto o tienda ya estaba en seguimiento.</p> : null}
      {searchParams.eliminado ? <p className={styles.aviso}>Seguimiento quitado.</p> : null}
      {searchParams.leida ? <p className={styles.aviso}>Alerta marcada como leída.</p> : null}

      <Tarjeta className={styles.seccion}>
        <p className={styles.tituloSeccion}>Alertas de hoy{alertasDelDia.length ? ` (${alertasDelDia.length})` : ""}</p>
        {alertasDelDia.length === 0 ? (
          <EstadoVacio>Sin alertas nuevas hoy todavía.</EstadoVacio>
        ) : (
          <ul className={styles.listaAlertas}>
            {alertasDelDia.map(({ alerta, nombreSeguimiento }) => (
              <li key={alerta.id} className={styles.filaAlerta}>
                <span>
                  <strong>{nombreSeguimiento}:</strong> {mensajeAlerta({ tipo: alerta.tipo, detalle: alerta.detalle as Record<string, unknown> })}
                </span>
                {alerta.leidaTs ? (
                  <Chip>Leída</Chip>
                ) : (
                  <form action={marcarAlertaLeidaAction}>
                    <input type="hidden" name="alertaId" value={alerta.id} />
                    <Boton type="submit" variante="fantasma" chico>
                      Marcar como leída
                    </Boton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <div className={styles.encabezadoSeccion}>
          <p className={styles.tituloSeccion}>Agregar producto, tienda o competidor</p>
          <PanelLateral textoBoton="Cómo encontrar el id / Ver guía" titulo="Cómo agregar un producto, tienda o competidor">
            <GuiaAgregarSeguimiento />
          </PanelLateral>
        </div>
        <form action={agregarSeguimientoAction} className={styles.filaFormulario}>
          <Campo etiqueta="Tipo">
            <select name="tipo" className="zx-control" defaultValue="producto">
              <option value="producto">Producto (publicación o catálogo)</option>
              <option value="tienda">Tienda / vendedor</option>
            </select>
          </Campo>
          <Campo
            etiqueta={
              <>
                Link o id de Mercado Libre
                <Ayuda id="ayuda-link-seguimiento">
                  <p>
                    <strong>Producto:</strong> el link de la publicación (articulo.mercadolibre.com.co/MCO-...) o del catálogo (.../p/MCO...), o el
                    id MCOxxxxxxxx directo.
                  </p>
                  <p>
                    <strong>Tienda:</strong> el número de seller_id, o un link que lo traiga — seller_id=, CustId= o _CustId_.
                  </p>
                  <p>
                    No sirven solos los links tipo /pagina/nombre o /tienda/nombre sin esos parámetros — abrí un producto de esa tienda y copiá el
                    seller_id, o usá el botón &quot;Seguir&quot; de la extensión de Zilonix.
                  </p>
                  <p>Marcar &quot;Es competidor&quot; cuenta en el cupo de 5.</p>
                </Ayuda>
              </>
            }
          >
            <input type="text" name="link" required placeholder="https://articulo.mercadolibre.com.co/MCO-..." className="zx-control" />
          </Campo>
          <label className={styles.casillaCompetidor}>
            <input type="checkbox" name="esCompetidor" value="1" />
            Es competidor
          </label>
          <Boton type="submit">Agregar</Boton>
        </form>
        <p className={styles.ayuda}>
          Tiendas de competencia: {tiendasCompetidorActivas}/{LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA}. Productos de competencia: {productosCompetidorActivos}/
          {LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA}.
        </p>
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <div className={styles.encabezadoSeccion}>
          <p className={styles.tituloSeccion}>Seguimientos activos</p>
          {/* Issue #251, punto 9 — abre la ficha/tienda de cada
          competidor en una pestaña nueva, con un clic real; la
          extensión lee cada página al cargar, igual que al abrirla a
          mano. Nunca se dispara sola. */}
          <BotonActualizarTodo links={linksCompetidores} />
        </div>
        {seguimientos.length === 0 ? (
          <EstadoVacio>Todavía no agregaste ningún producto, tienda o competidor.</EstadoVacio>
        ) : (
          <Tabla
            encabezados={[
              "Nombre",
              "Tipo",
              "Full",
              "Precio",
              "Inventario",
              "Vendidos",
              "Ventas ~30d",
              "Catálogo",
              "Gana botón",
              "Última revisión",
              "Link ML",
              "",
            ]}
          >
            {seguimientos.map(({ seguimiento, ultimaFoto, fotoAnterior, fotoHaceUnMes }) => {
              const ventasHoy = calcularVentasHoy(ultimaFoto?.vendidos ?? null, fotoAnterior?.vendidos ?? null);
              const deltaUnMes = fotoHaceUnMes ? calcularDelta(ultimaFoto?.vendidos ?? null, fotoHaceUnMes.vendidos) : null;
              // Issue #251 (corrección de Pablo, punto 3) — normaliza
              // ANTES de leer `.total`/`.visibles`: una fila vieja
              // puede traer el array plano sin envolver.
              const publicaciones = ultimaFoto ? normalizarPublicaciones(ultimaFoto.publicaciones) : null;
              // Issue #252 (smoke de staging) — el piso "+N vendidos"
              // (nunca comparado en alertas) vive en esta misma
              // columna para tipo="producto" — solo importa cuando
              // todavía no hay un `vendidos` exacto.
              const vendidosAproximado =
                ultimaFoto && ultimaFoto.vendidos == null ? obtenerVendidosAproximado(ultimaFoto.publicaciones) : null;
              // Issue #252 (smoke de staging, punto 3) — mismo respaldo
              // que vendidosAproximado, pero para el precio: MCO452014269
              // se quedó sin precio porque la API nunca lo confirmó
              // (seguimiento pendiente de primera revisión), aunque la
              // extensión sí lo había leído de la página.
              const precioAproximado = ultimaFoto && ultimaFoto.precio == null ? obtenerPrecioAproximado(ultimaFoto.publicaciones) : null;
              return (
                <FilaTabla key={seguimiento.id}>
                  <CeldaTabla>
                    <Link href={`/panel/investigacion/seguimiento/${seguimiento.id}`}>{seguimiento.nombre}</Link>
                    {/* Issue #201 — antes la tabla solo mostraba el id
                    (MCOxxxxx/seller_id), indistinguible entre filas; el
                    id sigue visible, pero como dato secundario, nunca
                    como el nombre principal. */}
                    <div className={styles.subdato}>{seguimiento.mlIdExterno}</div>
                    {seguimiento.esCompetidor ? <Chip estado="aviso">Competidor</Chip> : null}
                    {altasHoy.has(seguimiento.id) ? <Chip estado="exito">Alta hoy</Chip> : null}
                    {bajasHoy.has(seguimiento.id) ? <Chip estado="peligro">Baja hoy</Chip> : null}
                    {/* Issue #251, punto 10 — sin lectura de la
                    página hoy para un competidor: inventario/vendidos/
                    publicaciones todavía no tienen el dato real que
                    solo la extensión puede traer. */}
                    {necesitaLecturaDePagina({
                      esCompetidor: seguimiento.esCompetidor,
                      tipo: seguimiento.tipo,
                      // Issue #252 (smoke de staging) — `publicaciones`
                      // ya normalizada (arriba): la columna real ahora
                      // es una unión (`{vendidosAproximado}` también
                      // vive ahí para tipo="producto"), nunca el tipo
                      // más angosto que espera esta función.
                      ultimaFoto: ultimaFoto ? { ...ultimaFoto, publicaciones } : null,
                      ahora,
                    }) ? (
                      <div className={styles.subdato}>Actualiza hoy para ver cuánto vendieron</div>
                    ) : null}
                  </CeldaTabla>
                  <CeldaTabla>{seguimiento.tipo === "tienda" ? "Tienda" : "Producto"}</CeldaTabla>
                  <CeldaTabla>{siNoODesconocido(ultimaFoto?.esFull ?? null, "Full", "No full")}</CeldaTabla>
                  <CeldaTabla>
                    {ultimaFoto?.precio != null
                      ? celdaConDelta(ultimaFoto.precio, fotoAnterior?.precio ?? null, dinero)
                      : precioAproximado != null
                        ? `${dinero(precioAproximado)} (aproximado)`
                        : "—"}
                  </CeldaTabla>
                  <CeldaTabla>
                    {/* Issue #251, punto 7 — "Sin dato" en vez de "—"
                    cuando todavía no hay ninguna lectura (de la
                    página o de la API) para este campo. */}
                    {ultimaFoto?.inventarioDisponible == null
                      ? "Sin dato"
                      : celdaConDelta(ultimaFoto.inventarioDisponible, fotoAnterior?.inventarioDisponible ?? null, numeroPlano)}
                    {ultimaFoto?.inventarioAproximado ? <Chip>Aproximado</Chip> : null}
                  </CeldaTabla>
                  <CeldaTabla>
                    {seguimiento.tipo === "tienda" ? (
                      // Issue #251, punto 5 — el TOTAL real (lo que
                      // Mercado Libre muestra arriba del listado,
                      // "752 resultados"), no la cantidad de
                      // publicaciones visibles en esa sola carga de
                      // página (eso es solo el detalle, ver [id]/page.tsx).
                      // Issue #250, punto B — una tienda nunca trae
                      // "vendidos" de la API (lib/seguimiento/lector.ts,
                      // fotoVacia()) — `publicaciones.total` puede venir
                      // de la API (buscador público) o de la extensión
                      // (#251); si ninguna de las dos lo llenó todavía,
                      // es "Sin dato" (genérico a propósito, nunca "de
                      // la API": la extensión también puede ser la
                      // fuente que falta). Corrección de Pablo, punto 3
                      // — `total ?? visibles.length`: cuando el total
                      // real todavía no llegó pero SÍ hay publicaciones
                      // visibles (ej. la API solo trajo esas, nunca el
                      // total — da 403 real al listar), mostrar ESE
                      // conteo en vez de "Sin dato" — sigue siendo un
                      // dato real, aunque parcial.
                      publicaciones && (publicaciones.total != null || publicaciones.visibles.length > 0) ? (
                        <>
                          {publicaciones.total ?? publicaciones.visibles.length} publicaciones
                          <div className={styles.subdato}>Leído de la página el {fechaLegible(ultimaFoto!.fecha)}</div>
                        </>
                      ) : (
                        "Sin dato"
                      )
                    ) : (
                      <>
                        {/* Issue #252 (smoke de staging) — bug real:
                        con `vendidos` reservado al número exacto, el
                        piso "+N vendidos" que la extensión SÍ lee se
                        mostraba como "Sin dato", aunque la página lo
                        tuviera. Nunca se usa para alertas (ver
                        lib/seguimiento/alertas.ts) — es solo una
                        pista visual aproximada. */}
                        {ultimaFoto?.vendidos ?? (vendidosAproximado != null ? `+${vendidosAproximado} (aproximado)` : "Sin dato")}
                        {ventasHoy != null ? <div className={styles.subdato}>Ventas hoy: {ventasHoy}</div> : null}
                        {/* Issue #251, punto 7 — "leído de la página
                        el {fecha}": inventario/vendidos de un
                        competidor solo los llena esta lectura, nunca
                        la API (ver lib/trabajos/revisionDiariaSeguimiento.ts). */}
                        {seguimiento.esCompetidor && (ultimaFoto?.inventarioDisponible != null || ultimaFoto?.vendidos != null || vendidosAproximado != null) ? (
                          <div className={styles.subdato}>Leído de la página el {fechaLegible(ultimaFoto!.fecha)}</div>
                        ) : null}
                      </>
                    )}
                  </CeldaTabla>
                  <CeldaTabla>
                    {!fotoHaceUnMes ? "Aún sin 30 días" : deltaUnMes == null ? "—" : conSigno(deltaUnMes, numeroPlano)}
                  </CeldaTabla>
                  <CeldaTabla>{siNoODesconocido(ultimaFoto?.enCatalogo ?? null, "Sí", "No")}</CeldaTabla>
                  <CeldaTabla>{siNoODesconocido(ultimaFoto?.ganaBotonCompra ?? null, "Gana", "Pierde")}</CeldaTabla>
                  <CeldaTabla>{seguimiento.ultimaRevisionTs ? new Date(seguimiento.ultimaRevisionTs).toLocaleDateString("es-CO") : "Todavía sin revisar"}</CeldaTabla>
                  <CeldaTabla>
                    <a href={construirLinkMlDeSeguimiento(seguimiento.recursoMl, seguimiento.mlIdExterno)} target="_blank" rel="noopener noreferrer">
                      Ver en ML
                    </a>
                  </CeldaTabla>
                  <CeldaTabla>
                    <form action={eliminarSeguimientoAction}>
                      <input type="hidden" name="seguimientoId" value={seguimiento.id} />
                      <Boton type="submit" variante="fantasma" chico>
                        Quitar
                      </Boton>
                    </form>
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
        )}
      </Tarjeta>

      <BotonLink href="/panel/investigacion" variante="fantasma" chico className={styles.volver}>
        Volver a Investigación
      </BotonLink>
    </>
  );
}
