import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { listarRolesDeEmpresa } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 1.8 — ajustar roles es "autorizar" en "configuracion" (dar o
// quitar permisos es, por definición, un acto de autorización).
// Reemplaza el candado "solo el Dueño" de la tarea 1.7.
export default async function RolesPage() {
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
    return <SinAcceso mensaje={`Tu rol no puede ajustar los roles de ${empresa.nombre}.`} />;
  }

  const roles = await listarRolesDeEmpresa(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo={`Roles de ${empresa.nombre}`} />

      <ListaFilas>
        {roles.map((rol) => (
          <FilaLista key={rol.id}>
            <div className={styles.fila}>
              <span>
                {rol.nombre}
                <span className={styles.conteoPermisos}>
                  {rol.permisos.length} permiso{rol.permisos.length === 1 ? "" : "s"}
                </span>
              </span>
              {rol.nombre === "Dueño" ? (
                <span className={styles.siempreTodo}>Siempre todo</span>
              ) : (
                <Link href={`/panel/roles/${rol.id}`} className={styles.ajustar}>
                  Ajustar →
                </Link>
              )}
            </div>
          </FilaLista>
        ))}
      </ListaFilas>

      <BotonLink href="/panel/invitar" variante="fantasma" chico className={styles.volver}>
        ← Invitar persona
      </BotonLink>
    </>
  );
}
