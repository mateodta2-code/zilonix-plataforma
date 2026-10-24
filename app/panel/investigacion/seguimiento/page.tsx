import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarAlertasDelDia, listarSeguimientosConUltimaFoto, LIMITE_COMPETIDORES_POR_EMPRESA } from "@/lib/seguimiento/seguimientos";
import { mensajeAlerta } from "@/lib/seguimiento/alertas";
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
          <Tabla encabezados={["Nombre", "Tipo", "Precio", "Inventario", "Vendidos", "Catálogo", "Gana botón", "Última revisión", ""]}>
            {seguimientos.map(({ seguimiento, ultimaFoto }) => (
              <FilaTabla key={seguimiento.id}>
                <CeldaTabla>
                  <Link href={`/panel/investigacion/seguimiento/${seguimiento.id}`}>{seguimiento.nombre}</Link>
                  {seguimiento.esCompetidor ? <Chip estado="aviso">Competidor</Chip> : null}
                </CeldaTabla>
                <CeldaTabla>{seguimiento.tipo === "tienda" ? "Tienda" : "Producto"}</CeldaTabla>
                <CeldaTabla>{dinero(ultimaFoto?.precio ?? null)}</CeldaTabla>
                <CeldaTabla>
                  {ultimaFoto?.inventarioDisponible ?? "—"}
                  {ultimaFoto?.inventarioAproximado ? <Chip>Aproximado</Chip> : null}
                </CeldaTabla>
                <CeldaTabla>{ultimaFoto?.vendidos ?? "—"}</CeldaTabla>
                <CeldaTabla>{siNoODesconocido(ultimaFoto?.enCatalogo ?? null, "Sí", "No")}</CeldaTabla>
                <CeldaTabla>{siNoODesconocido(ultimaFoto?.ganaBotonCompra ?? null, "Gana", "Pierde")}</CeldaTabla>
                <CeldaTabla>{seguimiento.ultimaRevisionTs ? new Date(seguimiento.ultimaRevisionTs).toLocaleDateString("es-CO") : "Todavía sin revisar"}</CeldaTabla>
                <CeldaTabla>
                  <form action={eliminarSeguimientoAction}>
                    <input type="hidden" name="seguimientoId" value={seguimiento.id} />
                    <Boton type="submit" variante="fantasma" chico>
                      Quitar
                    </Boton>
                  </form>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <BotonLink href="/panel/investigacion" variante="fantasma" chico className={styles.volver}>
        Volver a Investigación
      </BotonLink>
    </>
  );
}
