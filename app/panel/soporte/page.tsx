import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarAccesosDeEmpresa } from "@/lib/acceso-temporal";
import { concederAccesoAction, revocarAccesoAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

// Tarea 1.11 (decisión D8) — el lado de la empresa: "El personal de
// Zilonix no ve tus ventas ni tus clientes sin tu permiso." Esta
// pantalla ES ese permiso — explícito, con fecha de vencimiento y
// diciendo qué va a ver soporte, no un interruptor genérico
// "sí/no" (evidencia real, Olist Tiny: les falta decir exactamente
// qué ve ese acceso — acá "alcance" es obligatorio).
export default async function SoportePage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "autorizar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje="Tu rol no puede gestionar el acceso de soporte." />;
  }

  const accesos = await listarAccesosDeEmpresa(empresa.id);
  const ahora = Date.now();

  return (
    <>
      <EncabezadoPagina
        titulo={`Acceso de soporte — ${empresa.nombre}`}
        descripcion="Por defecto, el equipo de Zilonix solo ve cuántos miembros tiene tu empresa — nunca quiénes son, ni ningún otro dato, sin que tú concedas un acceso temporal acá."
      />

      <Tarjeta>
        <form action={concederAccesoAction} className={styles.form}>
          <Campo etiqueta="¿Qué puede ver soporte? (sé específico)">
            <input name="alcance" required placeholder='ej. "Ver quién trabaja en la empresa, para resolver un ticket"' className="zx-control" />
          </Campo>
          <Campo etiqueta="Vence en (horas, máximo 360 = 15 días)">
            <input type="number" name="horas" defaultValue={48} min={1} max={360} required className="zx-control" />
          </Campo>
          <Boton type="submit" className={styles.botonConceder}>
            Conceder acceso temporal
          </Boton>
        </form>
      </Tarjeta>

      <div>
        <h2 className={styles.subtitulo}>Historial</h2>
        {accesos.length === 0 ? (
          <EstadoVacio>Nunca se ha concedido ningún acceso.</EstadoVacio>
        ) : (
          <ListaFilas>
            {accesos.map((a) => {
              const vencido = a.expiraTs.getTime() <= ahora;
              const activo = !a.revocadoTs && !vencido;
              const estadoChip = activo ? "exito" : a.revocadoTs ? "neutro" : "peligro";
              const textoEstado = activo ? "activo" : a.revocadoTs ? "revocado" : "vencido";
              return (
                <FilaLista key={a.id}>
                  <div className={styles.fila}>
                    <span className={styles.descripcionAcceso}>
                      {a.alcance}
                      <span className={styles.detalleAcceso}>
                        <Chip estado={estadoChip}>{textoEstado}</Chip> vence {a.expiraTs.toLocaleString("es-CO")}
                      </span>
                    </span>
                    {activo && (
                      <form action={revocarAccesoAction}>
                        <input type="hidden" name="accesoId" value={a.id} />
                        <Boton type="submit" variante="secundario" chico>
                          Revocar
                        </Boton>
                      </form>
                    )}
                  </div>
                </FilaLista>
              );
            })}
          </ListaFilas>
        )}
      </div>

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
