import { normalizarParametro } from "@/lib/filtros-listado";
import { fechaHoraBogota } from "@/components/finanzas/formato";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarInvitacionesSinAceptar } from "@/lib/bodega/invitaciones";
import { listarMiembros } from "@/lib/bodega/miembros";
import { NOMBRE_ROL_BODEGA, ROLES_INVITABLES_POR_ADMIN } from "@/lib/bodega/roles";
import styles from "@/app/panel/personas/page.module.css";
import { cambiarActivoAction, cambiarRolBodegaAction } from "./actions";

// Personas de la bodega (solo admin_bodega): lista, desactivar/reactivar y
// cambiar rol entre operario y domiciliario. Nadie se cambia a sí mismo y
// el administrador no se toca desde acá.
export default async function BodegaPersonasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;
  const { bodegaId, bodegaNombre } = decision.membresia;
  const miembros = await listarMiembros(bodegaId);
  const invitaciones = await listarInvitacionesSinAceptar(bodegaId);
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina titulo={`Personas de ${bodegaNombre}`} descripcion="Quién está en la bodega, con qué rol, y las invitaciones que faltan por aceptar." />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <Tarjeta className={styles.seccion}>
        <h2 className={styles.titulo}>Miembros ({miembros.length})</h2>
        <Tabla encabezados={["Persona", "Rol", "Estado", "Desde", "Acciones"]}>
          {miembros.map((m) => {
            const esYo = m.usuarioId === usuario.id;
            const intocable = esYo || m.rol === "admin_bodega";
            return (
              <FilaTabla key={m.miembroId}>
                <CeldaTabla>
                  <strong>{m.nombre}</strong>
                  {esYo && <span className={styles.suave}> (tú)</span>}
                  <div className={styles.suave}>{m.email}</div>
                </CeldaTabla>
                <CeldaTabla>
                  <Chip estado={m.rol === "admin_bodega" ? "exito" : "neutro"}>{NOMBRE_ROL_BODEGA[m.rol]}</Chip>
                </CeldaTabla>
                <CeldaTabla>
                  <Chip estado={m.activo ? "exito" : "neutro"}>{m.activo ? "activo" : "desactivado"}</Chip>
                </CeldaTabla>
                <CeldaTabla>
                  <span className={styles.suave}>{fechaHoraBogota(m.desde)}</span>
                </CeldaTabla>
                <CeldaTabla>
                  {intocable ? (
                    <span className={styles.suave}>{esYo ? "Tu propio acceso no se cambia acá." : "El administrador no se cambia acá."}</span>
                  ) : (
                    <div className={styles.formRol}>
                      <form action={cambiarRolBodegaAction} className={styles.formRol}>
                        <input type="hidden" name="miembroId" value={m.miembroId} />
                        <select name="rol" defaultValue={m.rol} className="zx-control" aria-label={`Rol de ${m.nombre}`}>
                          {ROLES_INVITABLES_POR_ADMIN.map((r) => (
                            <option key={r} value={r}>
                              {NOMBRE_ROL_BODEGA[r]}
                            </option>
                          ))}
                        </select>
                        <Boton type="submit" variante="primario">
                          Cambiar
                        </Boton>
                      </form>
                      <form action={cambiarActivoAction}>
                        <input type="hidden" name="miembroId" value={m.miembroId} />
                        <input type="hidden" name="activo" value={m.activo ? "0" : "1"} />
                        <Boton type="submit" variante="fantasma">
                          {m.activo ? "Desactivar" : "Reactivar"}
                        </Boton>
                      </form>
                    </div>
                  )}
                </CeldaTabla>
              </FilaTabla>
            );
          })}
        </Tabla>
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <h2 className={styles.titulo}>Invitaciones sin aceptar ({invitaciones.length})</h2>
        {invitaciones.length === 0 ? (
          <EstadoVacio>No hay invitaciones pendientes.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Correo", "Rol ofrecido", "Vence", "Estado"]}>
            {invitaciones.map((i) => (
              <FilaTabla key={i.id}>
                <CeldaTabla>{i.email}</CeldaTabla>
                <CeldaTabla>{NOMBRE_ROL_BODEGA[i.rol]}</CeldaTabla>
                <CeldaTabla>
                  <span className={styles.suave}>{fechaHoraBogota(i.expiraTs)}</span>
                </CeldaTabla>
                <CeldaTabla>
                  <Chip estado={i.estado === "valida" ? "aviso" : "peligro"}>{i.estado === "valida" ? "pendiente" : "vencida"}</Chip>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
