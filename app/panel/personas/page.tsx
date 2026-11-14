import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarPersonas, opcionesDeRol, ROL_DUENO } from "@/lib/personas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { fechaHoraBogota } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { cambiarRolAction } from "./actions";
import styles from "./page.module.css";

// Issue #370 — Personas: quién está en la empresa activa y con qué rol,
// las invitaciones sin aceptar y cambiar el rol de alguien sin volver a
// invitarlo. Ver pide personas.consultar; el selector de rol solo sale
// con personas.modificar (y la acción lo vuelve a pedir). En el selector
// solo salen los roles que quien mira puede dar (#124); el Dueño no se
// cambia desde acá y nadie se cambia su propio rol.
export default async function PersonasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre, permisos } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "personas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede ver las personas de ${empresa.nombre}.`} />;
  }

  const { miembros, invitaciones } = await listarPersonas(empresa.id, usuario.id, new Date());
  const puedeModificar = tienePermiso(permisos, "personas", "modificar");
  const puedeInvitar = tienePermiso(permisos, "personas", "crear");
  const opciones = puedeModificar ? (await opcionesDeRol(empresa.id, permisos)).filter((o) => o.puedeDar) : [];
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina titulo={`Personas de ${empresa.nombre}`} descripcion="Quién está en la empresa, con qué rol, y las invitaciones que faltan por aceptar." />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <Tarjeta className={styles.seccion}>
        <h2 className={styles.titulo}>Miembros ({miembros.length})</h2>
        <Tabla encabezados={["Persona", "Rol", "Desde", ...(puedeModificar ? ["Cambiar rol"] : [])]}>
          {miembros.map((m) => {
            const esYo = m.usuarioId === usuario.id;
            const esDueno = m.rolNombre === ROL_DUENO;
            return (
              <FilaTabla key={m.membresiaId}>
                <CeldaTabla>
                  <strong>{m.nombre}</strong>
                  {esYo && <span className={styles.suave}> (tú)</span>}
                  <div className={styles.suave}>{m.email}</div>
                </CeldaTabla>
                <CeldaTabla>
                  <Chip estado={esDueno ? "exito" : "neutro"}>{m.rolNombre}</Chip>
                </CeldaTabla>
                <CeldaTabla>
                  <span className={styles.suave}>{fechaHoraBogota(m.desde)}</span>
                </CeldaTabla>
                {puedeModificar && (
                  <CeldaTabla>
                    {esYo || esDueno ? (
                      <span className={styles.suave}>{esYo ? "Tu propio rol no se cambia acá." : "El Dueño no se cambia acá."}</span>
                    ) : (
                      <form action={cambiarRolAction} className={styles.formRol}>
                        <input type="hidden" name="membresiaId" value={m.membresiaId} />
                        <select
                          name="rol"
                          defaultValue={opciones.find((o) => o.clave === `rol:${m.rolId}`)?.clave ?? ""}
                          className="zx-control"
                          aria-label={`Rol de ${m.nombre}`}
                        >
                          {!opciones.some((o) => o.clave === `rol:${m.rolId}`) && (
                            <option value="" disabled>
                              {m.rolNombre} (no lo puedes asignar)
                            </option>
                          )}
                          {opciones.map((o) => (
                            <option key={o.clave} value={o.clave}>
                              {o.nombre}
                            </option>
                          ))}
                        </select>
                        <Boton type="submit" variante="secundario" chico>
                          Cambiar
                        </Boton>
                      </form>
                    )}
                  </CeldaTabla>
                )}
              </FilaTabla>
            );
          })}
        </Tabla>
        {puedeModificar && (
          <p className={styles.ayuda}>
            Solo salen los roles que tu rol puede dar. El cambio queda en Actividad y se nota en el menú de esa persona al recargar la página.
          </p>
        )}
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
                <CeldaTabla>{i.rolNombre}</CeldaTabla>
                <CeldaTabla>
                  <span className={styles.suave}>{fechaHoraBogota(i.expiraTs)}</span>
                </CeldaTabla>
                <CeldaTabla>
                  <Chip estado={i.estado === "pendiente" ? "aviso" : "peligro"}>{i.estado === "pendiente" ? "pendiente" : "vencida"}</Chip>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
        <p className={styles.ayuda}>
          Una invitación vencida no se puede aceptar: invita de nuevo desde «Invitar persona». Para cambiarle el rol a alguien que ya está, usa
          «Cambiar» arriba en vez de invitarlo otra vez.
        </p>
      </Tarjeta>

      {puedeInvitar && (
        <BotonLink href="/panel/invitar" variante="secundario" chico>
          Invitar persona
        </BotonLink>
      )}
    </>
  );
}
