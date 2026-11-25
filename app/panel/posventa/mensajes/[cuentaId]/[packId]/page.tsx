import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { obtenerConexionIA } from "@/lib/ia/conexion";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerConversacionMl, leerVentaPosventaMl, PATRON_ID_PACK, type MensajePosventa, type VentaPosventa } from "@/lib/ml/mensajesPosventa";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { iniciales } from "@/lib/ml/reclamos";
import { datosSitioMl } from "@/lib/ml/sitios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";
import { ComposerMensaje } from "./ComposerMensaje";
import { FichaVentaPosventa } from "./FichaVentaPosventa";
import styles from "../../Mensajes.module.css";

const ZONA = "America/Bogota";

function formatear(fecha: string | null, idioma: string, opciones: Intl.DateTimeFormatOptions): string {
  const ms = fecha ? Date.parse(fecha) : NaN;
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: ZONA }).format(new Date(ms)) : "";
}
const claveDia = (fecha: string | null) => (fecha && Number.isFinite(Date.parse(fecha)) ? new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA }) : "");
const esImagen = (tipo: string | null, archivo: string) => (tipo ?? "").startsWith("image/") || /\.(jpe?g|png|gif)$/i.test(archivo);

// Posventa-Mensajes (Refs #645) — chat de una venta. Lectura en vivo con
// mark_as_read=false; el texto del comprador se muestra como texto plano.
export default async function ChatVentaPage({ params }: { params: { cuentaId: string; packId: string } }) {
  if (!esUuid(params.cuentaId) || !PATRON_ID_PACK.test(params.packId)) notFound();
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Mensajes" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  // Cuenta ajena o inexistente: RLS no la devuelve → 404.
  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === params.cuentaId);
  if (!cuenta) notFound();

  let mensajes: MensajePosventa[] = [];
  let venta: VentaPosventa | null = null;
  let falla: string | null = cuenta.desconectadaTs ? "Token vencido — hay que reconectar la cuenta." : null;
  if (!falla) {
    try {
      const token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
      [mensajes, venta] = await Promise.all([leerConversacionMl(params.packId, cuenta.cuentaIdExterna, token), leerVentaPosventaMl(params.packId, token).catch(() => null)]);
    } catch (error) {
      console.warn(`[panel/posventa/mensajes] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      falla = motivoCuentaSinRevisar(error);
    }
  }

  const puedeEscribir = await requierePermiso(usuario.id, empresa.id, "ventas", "modificar").then(
    () => true,
    (error) => {
      if (error instanceof SinPermisoError) return false;
      throw error;
    }
  );
  const iaConectada = (await obtenerConexionIA(empresa.id)) !== null;
  const idioma = datosSitioMl(cuenta.siteId).idioma;
  const hoy = claveDia(new Date().toISOString());
  const nombre = venta?.compradorNombre ?? "Comprador";
  const primero = venta?.productos[0];
  let diaPrevio = "";

  return (
    <>
      <nav className={styles.migas} aria-label="Ruta">
        <Link href="/panel/posventa/mensajes">Mensajes</Link> › Venta #{params.packId}
      </nav>
      <EncabezadoPagina titulo={`Venta #${params.packId}`} descripcion="Los mensajes del comprador se leen en vivo de Mercado Libre y no se guardan. Abrir esta pantalla no los marca como leídos." />
      {falla && <div className={styles.aviso}>{falla}</div>}
      <div className={styles.rejilla}>
        <div className={styles.columna}>
          <Tarjeta>
            <section aria-label="Conversación">
              <header className={styles.comprador}>
                <span className={styles.avatar} aria-hidden="true">
                  {iniciales(nombre)}
                </span>
                <span className={styles.nombre}>{nombre}</span>
              </header>
              {mensajes.length === 0 && !falla && <p className={styles.vacio}>Todavía no hay mensajes en esta venta.</p>}
              <ol className={styles.mensajes}>
                {mensajes.map((m, i) => {
                  const dia = claveDia(m.fecha);
                  const separador = dia && dia !== diaPrevio;
                  if (dia) diaPrevio = dia;
                  return (
                    <li key={`${m.id ?? m.fecha}-${i}`} style={{ display: "grid", gap: 8 }}>
                      {separador && <p className={styles.separadorDia}>{dia === hoy ? "Hoy" : formatear(m.fecha, idioma, { dateStyle: "long" })}</p>}
                      <div className={`${styles.burbuja} ${m.autor === "vendedor" ? styles.burbujaVendedor : styles.burbujaComprador}`}>
                        {/* Texto plano: lo escribió un tercero, nunca HTML. */}
                        {m.texto && <p className={styles.texto}>{m.texto}</p>}
                        {m.moderado && <span className={styles.moderado}>Mercado Libre restringió parte de este mensaje.</span>}
                        {m.adjuntos.map((a) => {
                          const url = `/api/ml/mensajes/${cuenta.id}/adjuntos/${encodeURIComponent(a.archivo)}`;
                          return esImagen(a.tipo, a.archivo) ? (
                            <FotoConZoom key={a.archivo} src={url} alt={a.nombre} claseMiniatura={styles.miniatura} />
                          ) : (
                            <a key={a.archivo} href={url} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                              {a.nombre}
                            </a>
                          );
                        })}
                        <span className={styles.hora}>
                          {formatear(m.fecha, idioma, { timeStyle: "short" })}
                          {m.autor === "vendedor" && m.leido ? " ✓✓" : m.autor === "vendedor" ? " ✓" : ""}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </Tarjeta>
          <ComposerMensaje
            cuentaId={cuenta.id}
            packId={params.packId}
            iaConectada={iaConectada}
            sinPermiso={!puedeEscribir}
            producto={primero?.titulo ?? null}
            variacion={primero?.variaciones.map((v) => `${v.nombre}: ${v.valor}`).join(", ") || null}
          />
        </div>
        <Tarjeta>
          <FichaVentaPosventa ordenId={params.packId} venta={venta} siteId={cuenta.siteId} />
        </Tarjeta>
      </div>
    </>
  );
}
