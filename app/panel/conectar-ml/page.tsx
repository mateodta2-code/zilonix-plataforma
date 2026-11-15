import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { obtenerUltimaImportacion } from "@/lib/ml/importacion";
import { datosSitioMl } from "@/lib/ml/sitios";
import { listarCuentasConectadas as listarCuentasFalabella } from "@/lib/falabella/cuentas";
import { contarPedidosPorCuenta as contarPedidosFalabella, TOPE_ORDENES as TOPE_ORDENES_FALABELLA } from "@/lib/falabella/pedidos";
import { conectarCuentaFalabella, desconectarCuentaFalabella, sincronizarPedidosFalabella } from "./actions";
import { BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Bug real: antes esta pantalla mostraba `searchParams.error` tal
// cual, y /api/ml/callback le pasaba ahí el `error.message` crudo de
// cualquier falla (texto de Mercado Libre o de Postgres). Ahora el
// Route Handler solo manda uno de estos códigos fijos — un mapa
// cerrado, nunca el valor de la URL: cualquier código que no esté en
// esta lista (incluido texto arbitrario) cae en el mensaje genérico.
// Issue #181 — "cuenta_en_otra_empresa" ya no lo manda
// /api/ml/callback (ahora redirige a /confirmar-transferencia en vez
// de mostrar este error), pero el código fijo se mantiene para no
// confundir un link viejo guardado (favorito, historial del
// navegador) con el genérico.
const MENSAJES_ERROR_CONECTAR: Record<string, string> = {
  cuenta_en_otra_empresa: "Esta cuenta de Mercado Libre ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.",
  estado_vencido: "La conexión tardó demasiado o se perdió el estado — empieza de nuevo con \"Conectar Mercado Libre\".",
  ml_rechazo: "Mercado Libre no autorizó la conexión.",
  sin_permiso: "No tienes permiso para conectar una cuenta de Mercado Libre.",
  error_desconocido: "No se pudo conectar la cuenta — intenta de nuevo en un momento.",
  // Conector Falabella (15/11) — pantalla unificada "Conectar marketplace"
  // (pedido de Sharel/Pablo, PR #415): prefijo "falabella_" para que un
  // código de error de este canal nunca pise el significado de uno de
  // Mercado Libre (ej. "cuenta_en_otra_empresa" ya significa otra cosa
  // del lado de ML).
  falabella_faltan_datos: "Faltan datos — UserID (correo), API Key y Seller ID son obligatorios.",
  falabella_cuenta_en_otra_empresa: "Esta cuenta de Falabella ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.",
  falabella_datos_invalidos: "Revisa los datos: el UserID debe ser un correo válido y el Seller ID solo puede tener letras, números, «_», «.» y «-».",
  falabella_credenciales_invalidas: "Falabella no aceptó esas credenciales. Revisa que el UserID, la API Key y el Seller ID sean los de tu cuenta en Seller Center.",
  falabella_no_disponible: "Falabella no respondió bien en este momento (puede estar caído o lento). Tus datos no se cambiaron; intenta de nuevo en unos minutos.",
  falabella_sincronizar_fallo: "No se pudieron traer los pedidos de Falabella. Intenta de nuevo en un momento.",
  falabella_configuracion: "No pudimos conectar por un problema de configuración de Zilonix, no de tus datos. Intenta más tarde o avísanos.",
  falabella_error_desconocido: "No se pudo conectar la cuenta de Falabella — revisa el UserID y la API Key e intenta de nuevo.",
};
const MENSAJE_ERROR_POR_DEFECTO = "No se pudo conectar la cuenta — intenta de nuevo en un momento.";

// true si el usuario tiene el permiso; false si no (nunca traga otro error).
async function tienePermiso(...args: Parameters<typeof requierePermiso>): Promise<boolean> {
  try {
    await requierePermiso(...args);
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

// Tarea 2.3 — "Conectar ML en 1 clic". Regla de UX #1 del plan técnico
// ("si el canal no está habilitado para ese plan/cuenta, avisarlo ANTES
// de mandar a la pantalla de autorización de ML", evidencia real contra
// Multivende): honestidad del alcance — todavía no existe ningún
// sistema de planes en Zilonix (llega en la Fase 4, "piloto pagado"),
// así que hoy no hay nada real que esta pantalla pueda chequear antes
// de redirigir. El día que exista un plan con canales habilitados/
// deshabilitados, ese chequeo se agrega acá mismo, antes de construir
// el link de abajo — no se inventa un candado falso hoy solo para
// simular que la regla ya está resuelta.
export default async function ConectarMlPage({
  searchParams,
}: {
  searchParams: { conectado?: string; conectado_falabella?: string; error?: string; aviso?: string };
}) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Conectar marketplace" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />
      </>
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
  const cuentasFalabella = await listarCuentasFalabella(empresa.id);
  const pedidosPorCuentaFalabella = await contarPedidosFalabella(empresa.id);
  // Revisión del PR #415: el servidor ya bloquea estas acciones, pero no
  // se muestran botones que van a fallar.
  const puedeConectar = await tienePermiso(usuario.id, empresa.id, "configuracion", "crear");
  const puedeDesconectar = await tienePermiso(usuario.id, empresa.id, "configuracion", "modificar");
  const esErrorFalabella = searchParams.error?.startsWith("falabella_") ?? false;
  // Bug real (PKCE): el link de autorización ya no se arma acá — cada
  // intento necesita un code_verifier NUEVO (de un solo uso), así que
  // /api/ml/conectar lo genera recién al hacer clic, no de antemano en
  // esta misma carga de la página.
  const urlConectar = "/api/ml/conectar";

  // Tarea 2.5 — importación inicial corriendo en segundo plano, una
  // por cada cuenta conectada (sin cliente de JS aparte: un refresco
  // automático de la página alcanza mientras haya alguna sin terminar).
  const importaciones = await Promise.all(
    cuentas.filter((c) => !c.desconectadaTs).map(async (c) => ({ cuenta: c, importacion: await obtenerUltimaImportacion(empresa.id, c.id) }))
  );
  const hayImportacionEnCurso = importaciones.some((i) => i.importacion && !i.importacion.completadoTs);

  return (
    <>
      {hayImportacionEnCurso && <meta httpEquiv="refresh" content="5" />}
      <EncabezadoPagina titulo="Conectar marketplace" />

      {searchParams.conectado && <div className={styles.avisoExito}>Cuenta conectada.</div>}
      {searchParams.conectado_falabella && <div className={styles.avisoExito}>Cuenta de Falabella conectada.</div>}
      {searchParams.aviso === "falabella_tope_ordenes" && (
        <div className={styles.avisoInfo}>
          Se importaron los primeros {TOPE_ORDENES_FALABELLA.toLocaleString("es-CO")} pedidos de Falabella de los últimos 60 días, que es el
          máximo por sincronización. Puede haber más pedidos que todavía no se trajeron.
        </div>
      )}
      {searchParams.error && (
        // Regla de UX #2 del plan técnico (evidencia real contra
        // Multivende: si el canje del code por el token falla, se
        // queda en spinner infinito, sin ningún mensaje) — acá se ve
        // el error real y un botón para reintentar, nunca un
        // silencio.
        <div className={styles.avisoError}>
          <p className={styles.avisoErrorTexto}>{MENSAJES_ERROR_CONECTAR[searchParams.error] ?? MENSAJE_ERROR_POR_DEFECTO}</p>
          {/* <a> normal, no next/link: /api/ml/conectar es un Route
              Handler que arranca el OAuth real, necesita una
              navegación de verdad del navegador. */}
          {/* Revisión del PR #415: con un error de Falabella, "Reintentar"
              abría el OAuth de Mercado Libre — ahí el formulario de abajo
              ya es el reintento. */}
          {!esErrorFalabella && (
            <a href={urlConectar} className={styles.reintentar}>
              Reintentar
            </a>
          )}
        </div>
      )}

      <h3 className={styles.tituloCanal}>Mercado Libre</h3>

      {cuentas.length === 0 && (
        // Issue #323 — siguiente paso concreto: conectar es justo lo
        // que esta pantalla ya ofrece abajo, acá solo se explica para
        // qué sirve antes del botón.
        <EstadoVacio>Todavía no tienes ninguna cuenta conectada. Conecta tu cuenta de Mercado Libre para empezar a ver tus pedidos.</EstadoVacio>
      )}

      {cuentas.length > 0 && (
        <ListaFilas>
          {cuentas.map((cuenta) => {
            const importacion = importaciones.find((i) => i.cuenta.id === cuenta.id)?.importacion;
            // Issue #315 (Z-LATAM-01), parte 2 — país desde SITIOS_ML
            // (lib/ml/sitios.ts), nunca un nombre fijo; cuenta.moneda e
            // idioma ya vienen reales de la fila (listarCuentasConectadas).
            const sitio = datosSitioMl(cuenta.siteId);
            return (
              <FilaLista key={cuenta.id}>
                <div className={styles.filaCuenta}>
                  <span>
                    Conectado como <strong>{cuenta.nickname}</strong>
                    {cuenta.desconectadaTs && <Chip>Desconectada</Chip>}
                  </span>
                  {!cuenta.desconectadaTs && (
                    <Link href={`/panel/conectar-ml/${cuenta.id}/desconectar`} className={styles.desconectar}>
                      Desconectar
                    </Link>
                  )}
                </div>
                <div className={styles.detalleSitio}>
                  {sitio.nombre} · {cuenta.moneda} · {cuenta.idioma}
                </div>
                {importacion && !importacion.error && (
                  <div className={styles.detalleImportacion}>
                    {importacion.completadoTs ? (
                      <span>
                        Importación lista: {importacion.pedidosImportados} pedidos, {importacion.publicacionesImportadas} publicaciones
                        (últimos 60 días).
                      </span>
                    ) : (
                      <span>
                        Importando pedidos y publicaciones de los últimos 60 días… {importacion.pedidosImportados}
                        {importacion.pedidosEncontrados ? `/${importacion.pedidosEncontrados}` : ""} pedidos.
                      </span>
                    )}
                  </div>
                )}
                {importacion?.error && <div className={styles.errorImportacion}>No se pudo completar la importación: {importacion.error}</div>}
              </FilaLista>
            );
          })}
        </ListaFilas>
      )}

      {/* <a> normal, no next/link — ver nota de "Reintentar" arriba. */}
      <a href={urlConectar} className={clasesBoton("primario")}>
        Conectar Mercado Libre
      </a>

      <h3 className={styles.tituloCanal}>Falabella</h3>

      <div className={styles.avisoInfo}>
        <ol className={styles.pasosFalabella}>
          <li>
            Entra a{" "}
            <a href="https://sellercenter.falabella.com" target="_blank" rel="noreferrer">
              sellercenter.falabella.com
            </a>
            .
          </li>
          <li>Ve a Mi cuenta → Usuarios. Tu correo es el UserID y la API Key está en la columna «Api Key».</li>
          <li>
            Tu usuario necesita un rol con acceso a la API (Seller Full Access o Seller API Access). Si no lo tiene, pídeselo al
            administrador de tu tienda.
          </li>
          <li>El Seller ID está en Mi cuenta → Mi perfil.</li>
          <li>Pega los tres datos aquí y dale Conectar Falabella.</li>
        </ol>
      </div>

      {cuentasFalabella.length === 0 && <EstadoVacio>Todavía no tienes ninguna cuenta de Falabella conectada.</EstadoVacio>}

      {cuentasFalabella.length > 0 && (
        <ListaFilas>
          {cuentasFalabella.map((cuenta) => {
            const pedidosDeLaCuenta = pedidosPorCuentaFalabella.get(cuenta.id) ?? 0;
            return (
              <FilaLista key={cuenta.id}>
                <div className={styles.filaCuenta}>
                  <span>
                    Conectado como <strong>{cuenta.nickname}</strong> ({cuenta.userId})
                    {cuenta.desconectadaTs && <Chip>Desconectada</Chip>}
                  </span>
                  {!cuenta.desconectadaTs && puedeDesconectar && (
                    <form action={desconectarCuentaFalabella.bind(null, cuenta.id)}>
                      <button type="submit" className={styles.desconectar}>
                        Desconectar
                      </button>
                    </form>
                  )}
                </div>
                {!cuenta.desconectadaTs && puedeConectar && (
                  <form action={sincronizarPedidosFalabella.bind(null, cuenta.id)} className={styles.formSincronizar}>
                    <button type="submit" className={clasesBoton("secundario")}>
                      Sincronizar pedidos (últimos 60 días)
                    </button>
                  </form>
                )}
                <div className={styles.detalleImportacion}>{pedidosDeLaCuenta} pedido(s) importado(s).</div>
              </FilaLista>
            );
          })}
        </ListaFilas>
      )}

      {puedeConectar && (
        <form action={conectarCuentaFalabella} className={styles.formConectar}>
          <Campo etiqueta="UserID (correo de Seller Center)">
            <input type="email" name="userId" required maxLength={254} className="zx-control" />
          </Campo>
          <Campo etiqueta="API Key">
            <input type="password" name="apiKey" required maxLength={256} autoComplete="off" className="zx-control" />
          </Campo>
          <Campo etiqueta="Seller ID (código de vendedor, empieza por SC, ej. SC0170C)">
            <input type="text" name="sellerId" required maxLength={100} pattern="[A-Za-z0-9_.\-]+" className="zx-control" />
          </Campo>
          <Campo etiqueta="Nombre para identificarla en Zilonix (opcional)">
            <input type="text" name="nickname" maxLength={100} className="zx-control" />
          </Campo>
          <button type="submit" className={clasesBoton("primario")}>
            Conectar Falabella
          </button>
        </form>
      )}

      <BotonLink href="/panel" variante="fantasma" chico>
        Volver al panel
      </BotonLink>
    </>
  );
}
