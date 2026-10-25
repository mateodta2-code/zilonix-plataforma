import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerEmpresaDueñaDeCuentaMl } from "@/lib/ml/cuentas";
import { descifrarTransferenciaPendiente, NOMBRE_COOKIE_TRANSFERENCIA } from "@/lib/ml/transferencia-cookie";
import { Boton } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { confirmarTransferenciaAction, cancelarTransferenciaAction } from "./actions";
import styles from "./page.module.css";

// Issue #181 — pedido de producto: si al conectar Mercado Libre la
// cuenta ya está conectada en OTRA empresa, en vez de solo mostrar un
// error se ofrece transferirla. Esta pantalla es a donde
// /api/ml/callback redirige en ese caso (ver CuentaMlDeOtraEmpresaError
// en lib/ml/cuentas.ts) — los tokens nuevos viajan cifrados en una
// cookie httpOnly de 10 minutos (lib/ml/transferencia-cookie.ts),
// nunca en la URL.
export default async function ConfirmarTransferenciaMlPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Transferir cuenta de Mercado Libre" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} volverHref="/panel/conectar-ml" />
      </>
    );
  }

  // Sin cookie (vencida a los 10 minutos, ya confirmada/cancelada, o
  // nadie llegó acá por el flujo real de /api/ml/callback) — no hay
  // nada que confirmar. Mismo código que "la conexión tardó demasiado"
  // (ver page.tsx de /panel/conectar-ml): el significado real es el
  // mismo, un estado intermedio que ya no está disponible.
  const valorCookie = cookies().get(NOMBRE_COOKIE_TRANSFERENCIA)?.value;
  const pendiente = valorCookie ? descifrarTransferenciaPendiente(valorCookie) : null;
  if (!pendiente) redirect("/panel/conectar-ml?error=estado_vencido");

  const dueña = await obtenerEmpresaDueñaDeCuentaMl(pendiente.cuentaIdExterna);
  if (!dueña) redirect("/panel/conectar-ml?error=error_desconocido");

  return (
    <>
      <EncabezadoPagina titulo="Transferir cuenta de Mercado Libre" />
      <p className={styles.mensaje}>
        La cuenta de Mercado Libre «{pendiente.nickname}» ya está conectada a la empresa «{dueña.empresaNombre}». Si continuás, se desconectará de
        allá y quedará conectada en esta empresa.
      </p>
      <p className={styles.aclaracion}>Los pedidos y publicaciones que ya se importaron allá no se mueven ni se borran — solo la conexión cambia.</p>
      <div className={styles.acciones}>
        <form action={confirmarTransferenciaAction}>
          <Boton type="submit">Confirmar transferencia</Boton>
        </form>
        <form action={cancelarTransferenciaAction}>
          <Boton type="submit" variante="secundario">
            Cancelar
          </Boton>
        </form>
      </div>
    </>
  );
}
