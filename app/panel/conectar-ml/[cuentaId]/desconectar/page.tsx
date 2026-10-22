import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { desconectarCuentaAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 2.3 — regla de UX #3: avisar explícito qué deja de verse ANTES
// de desconectar, nunca un botón que borra directo sin pantalla
// intermedia (evidencia real de UpSeller: desconectar escondía los
// pedidos sin avisar qué se perdía).
export default async function DesconectarMlPage({ params }: { params: { cuentaId: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <SinAcceso
        mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede desconectar cuentas.`}
        volverHref="/panel/conectar-ml"
        volverTexto="Volver"
      />
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
  const cuenta = cuentas.find((c) => c.id === params.cuentaId);
  if (!cuenta) redirect("/panel/conectar-ml");

  const desconectar = desconectarCuentaAction.bind(null, params.cuentaId);

  return (
    <>
      <EncabezadoPagina
        titulo={`Desconectar ${cuenta.nickname}`}
        descripcion={
          <>
            Al desconectar esta cuenta, Zilonix deja de traer pedidos, mensajes y stock nuevos de <strong>{cuenta.nickname}</strong>. Lo que
            ya se importó <strong>no se borra</strong> — sigue visible en el histórico. Puedes volver a conectarla cuando quieras.
          </>
        }
      />
      <form action={desconectar} className={styles.form}>
        <Boton type="submit">Sí, desconectar</Boton>
        <BotonLink href="/panel/conectar-ml" variante="secundario">
          Cancelar
        </BotonLink>
      </form>
    </>
  );
}
