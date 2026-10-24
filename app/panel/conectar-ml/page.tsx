import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { obtenerUltimaImportacion } from "@/lib/ml/importacion";
import { BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Issue #151 — bug real: antes esta pantalla mostraba `searchParams.error`
// tal cual, y /api/ml/callback le pasaba ahí el `error.message` crudo de
// cualquier falla (texto de Mercado Libre o de Postgres, hasta 300
// caracteres según lib/ml/oauth.ts). Ahora el Route Handler solo manda
// uno de estos códigos fijos — un mapa cerrado, nunca el valor de la
// URL: cualquier código que no esté en esta lista (incluido texto
// arbitrario armado a mano) cae en el mensaje genérico de abajo.
const MENSAJES_ERROR_CONECTAR: Record<string, string> = {
  cuenta_en_otra_empresa: "Esta cuenta de Mercado Libre ya está conectada a otra empresa — no se puede conectar dos veces.",
  estado_vencido: "La conexión tardó demasiado o se perdió el estado — empezá de nuevo con \"Conectar Mercado Libre\".",
  ml_rechazo: "Mercado Libre no autorizó la conexión.",
  sin_permiso: "No tenés permiso para conectar una cuenta de Mercado Libre.",
  error_desconocido: "No se pudo conectar la cuenta — intentá de nuevo en un momento.",
};
const MENSAJE_ERROR_POR_DEFECTO = "No se pudo conectar la cuenta — intentá de nuevo en un momento.";

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
export default async function ConectarMlPage({ searchParams }: { searchParams: { conectado?: string; error?: string } }) {
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
        <EncabezadoPagina titulo="Conectar Mercado Libre" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />
      </>
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
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
      <EncabezadoPagina titulo="Conectar Mercado Libre" />

      {searchParams.conectado && <div className={styles.avisoExito}>Cuenta conectada.</div>}
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
          <a href={urlConectar} className={styles.reintentar}>
            Reintentar
          </a>
        </div>
      )}

      {cuentas.length > 0 && (
        <ListaFilas>
          {cuentas.map((cuenta) => {
            const importacion = importaciones.find((i) => i.cuenta.id === cuenta.id)?.importacion;
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

      <BotonLink href="/panel" variante="fantasma" chico>
        Volver al panel
      </BotonLink>
    </>
  );
}
