import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { permisosDeRolesPorNombre, plantillasQuePuedeDar } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { crearInvitacionAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

// Tarea 1.8 — invitar a alguien es "crear" en el módulo "personas":
// reemplaza el candado "solo el Dueño puede invitar" de la tarea 1.7
// por la función única de permisos. El rol "Dueño" sigue siendo el
// único que lo cumple por defecto (nace con todo sobre todo), pero
// ahora es porque tiene el permiso, no porque el código lo compara con
// el texto "Dueño" a mano.
export default async function InvitarPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  let miMembresia;
  try {
    miMembresia = await requierePermiso(usuario.id, empresa.id, "personas", "crear");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol no puede invitar personas a ${empresa.nombre}.`} />;
  }

  // Issue #124 — solo se ofrecen los roles que esta persona puede dar
  // (crearInvitacionAction lo vuelve a comprobar en el servidor).
  const rolesQuePuedeDar = plantillasQuePuedeDar(miMembresia.permisos, await permisosDeRolesPorNombre(empresa.id));
  if (rolesQuePuedeDar.length === 0) {
    return <SinAcceso mensaje={`Tu rol (${miMembresia.rolNombre}) no tiene todos los permisos de ningún rol, así que no puede invitar a nadie.`} />;
  }

  return (
    <>
      <EncabezadoPagina
        titulo={`Invitar a ${empresa.nombre}`}
        descripcion="Se genera un link de un solo uso que vence en 7 días — nunca se comparte una contraseña."
      />

      <Tarjeta>
        <form action={crearInvitacionAction} className={styles.form}>
          <Campo etiqueta="Correo de la persona">
            <input type="email" name="email" required className="zx-control" />
          </Campo>
          <Campo etiqueta="Rol">
            <select name="rol" required className="zx-control">
              {rolesQuePuedeDar.map((nombre) => (
                <option key={nombre} value={nombre}>
                  {nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Boton type="submit" className={styles.botonEnviar}>
            Generar invitación
          </Boton>
        </form>
      </Tarjeta>

      <BotonLink href="/panel/roles" variante="fantasma" chico className={styles.volver}>
        Ajustar permisos de los roles →
      </BotonLink>
    </>
  );
}
