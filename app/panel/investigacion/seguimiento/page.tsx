import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarAlertasDelDia, listarSeguimientosConUltimaFoto, LIMITE_COMPETIDORES_POR_EMPRESA } from "@/lib/seguimiento/seguimientos";
import { mensajeAlerta } from "@/lib/seguimiento/alertas";
import { calcularDelta, calcularVentasHoy } from "@/lib/seguimiento/comparativa";
import { construirLinkMlDeSeguimiento } from "@/lib/seguimiento/link";
import { Ayuda } from "@/components/marco/Ayuda";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { agregarSeguimientoAction, eliminarSeguimientoAction, marcarAlertaLeidaAction, procesarAgregarPorQuery } from "./actions";
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
  searchParams: { error?: string; agregado?: string; eliminado?: string; leida?: string; yaExistia?: string; agregar?: string; agregar_tienda?: string };
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
  const competidoresActivos = seguimientos.filter((s) => s.seguimiento.esCompetidor).length;

  // Issue #195 — chip "Alta/Baja hoy" en la fila de una tienda cuando
  // la revisión diaria ya generó la alerta correspondiente HOY (las
  // alertas en sí ya se ven arriba, en "Alertas de hoy" — esto es solo
  // un aviso rápido en la propia fila, para no tener que buscarla).
  const altasHoy = new Set(alertasDelDia.filter((a) => a.alerta.tipo === "publicacion_nueva").map((a) => a.alerta.seguimientoId));
  const bajasHoy = new Set(alertasDelDia.filter((a) => a.alerta.tipo === "publicacion_eliminada").map((a) => a.alerta.seguimientoId));

  return (
    <>
      <EncabezadoPagina
        titulo="Seguimiento"
        descripcion="Seguimiento diario de productos, tiendas y competidores de Mercado Libre — precio, inventario, ventas y alertas cuando algo cambia."
      />

      {searchParams.error ? <EstadoVacio>{searchParams.error}</EstadoVacio> : null}
      {searchParams.agregado ? <p className={styles.aviso}>Seguimiento agregado — la primera foto llega con la próxima revisión diaria.</p> : null}
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
        <p className={styles.tituloSeccion}>Agregar producto, tienda o competidor</p>
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
          Competidores marcados: {competidoresActivos}/{LIMITE_COMPETIDORES_POR_EMPRESA}.
        </p>
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <p className={styles.tituloSeccion}>Seguimientos activos</p>
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
                  </CeldaTabla>
                  <CeldaTabla>{seguimiento.tipo === "tienda" ? "Tienda" : "Producto"}</CeldaTabla>
                  <CeldaTabla>{siNoODesconocido(ultimaFoto?.esFull ?? null, "Full", "No full")}</CeldaTabla>
                  <CeldaTabla>{celdaConDelta(ultimaFoto?.precio ?? null, fotoAnterior?.precio ?? null, dinero)}</CeldaTabla>
                  <CeldaTabla>
                    {celdaConDelta(ultimaFoto?.inventarioDisponible ?? null, fotoAnterior?.inventarioDisponible ?? null, numeroPlano)}
                    {ultimaFoto?.inventarioAproximado ? <Chip>Aproximado</Chip> : null}
                  </CeldaTabla>
                  <CeldaTabla>
                    {ultimaFoto?.vendidos ?? "—"}
                    {ventasHoy != null ? <div className={styles.subdato}>Ventas hoy: {ventasHoy}</div> : null}
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
