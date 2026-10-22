import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { ACCIONES, esPeligroso, MODULOS, obtenerRolDeEmpresa } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { guardarPermisosAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 1.7 — "puede ajustar permisos por acción": una celda por
// módulo × acción, con el alcance (todo/propio) elegido en la misma
// celda. Tarea 1.8 — la celdas marcadas en rojo son "peligrosas"
// (lib/roles.ts, PERMISOS_PELIGROSOS): se pueden marcar acá sin
// fricción, pero guardarPermisosAction manda a una pantalla de
// confirmación aparte antes de activarlas de verdad.
export default async function EditarRolPage({ params }: { params: { rolId: string } }) {
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
    return <SinAcceso mensaje="Tu rol no puede ajustar permisos." />;
  }

  const rol = await obtenerRolDeEmpresa(empresa.id, params.rolId);
  if (!rol) redirect("/panel/roles");
  if (rol.nombre === "Dueño") redirect("/panel/roles");

  const valorActual = (modulo: string, accion: string) =>
    rol.permisos.find((p) => p.modulo === modulo && p.accion === accion)?.alcance ?? "no";

  return (
    <>
      <EncabezadoPagina
        titulo={`Permisos de ${rol.nombre}`}
        descripcion={
          <>
            "Propio" limita la acción a lo que esa misma persona creó — nunca a lo de todos. Las celdas en{" "}
            <span className={styles.rojo}>rojo</span> piden confirmación aparte antes de activarse.
          </>
        }
      />

      <form action={guardarPermisosAction} className={styles.form}>
        <input type="hidden" name="rolId" value={rol.id} />
        <Tabla encabezados={["Módulo", ...ACCIONES]}>
          {MODULOS.map((modulo) => (
            <FilaTabla key={modulo}>
              <CeldaTabla className={styles.celdaModulo}>{modulo}</CeldaTabla>
              {ACCIONES.map((accion) => {
                const peligroso = esPeligroso(modulo, accion);
                return (
                  <CeldaTabla key={accion}>
                    <select
                      name={`permiso__${modulo}__${accion}`}
                      defaultValue={valorActual(modulo, accion)}
                      className={`zx-control ${styles.select} ${peligroso ? styles.selectPeligroso : ""}`}
                    >
                      <option value="no">No</option>
                      <option value="todo">Todo</option>
                      <option value="propio">Propio</option>
                    </select>
                  </CeldaTabla>
                );
              })}
            </FilaTabla>
          ))}
        </Tabla>
        <Boton type="submit" className={styles.botonGuardar}>
          Guardar permisos
        </Boton>
      </form>

      <BotonLink href="/panel/roles" variante="fantasma" chico className={styles.volver}>
        ← Volver a roles
      </BotonLink>
    </>
  );
}
