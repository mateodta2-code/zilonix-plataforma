import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { decodificarPermisos, esPeligroso, obtenerRolDeEmpresa } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { confirmarPermisosAction } from "../actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 1.8 — "intentar dar un permiso peligroso desde una plantilla
// pide confirmación aparte": esta es esa pantalla aparte. Nunca se
// llega acá por accidente, solo porque guardarPermisosAction detectó
// un permiso peligroso NUEVO y redirigió — y esta pantalla vuelve a
// exigir el permiso de quien confirma, no se fía de la redirección.
export default async function ConfirmarPermisosPage({
  params,
  searchParams,
}: {
  params: { rolId: string };
  searchParams: { pendiente?: string };
}) {
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

  const pendiente = searchParams.pendiente ?? "";
  const propuestos = decodificarPermisos(pendiente);
  const peligrosos = propuestos.filter((p) => esPeligroso(p.modulo, p.accion));

  if (peligrosos.length === 0) redirect(`/panel/roles/${rol.id}`);

  return (
    <>
      <EncabezadoPagina
        titulo="Confirma estos permisos"
        descripcion={
          <>
            Le vas a dar a <b>{rol.nombre}</b> permisos que pueden cambiar cosas sensibles de la empresa:
          </>
        }
      />

      <ul className={styles.listaPeligrosos}>
        {peligrosos.map((p, i) => (
          <li key={i}>
            {p.accion} en {p.modulo} ({p.alcance})
          </li>
        ))}
      </ul>

      <form action={confirmarPermisosAction} className={styles.form}>
        <input type="hidden" name="rolId" value={rol.id} />
        <input type="hidden" name="pendiente" value={pendiente} />
        <Boton type="submit">Sí, confirmo estos permisos</Boton>
        <BotonLink href={`/panel/roles/${rol.id}`} variante="secundario">
          Cancelar
        </BotonLink>
      </form>
    </>
  );
}
