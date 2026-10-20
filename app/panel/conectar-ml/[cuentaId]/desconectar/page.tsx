import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { desconectarCuentaAction } from "./actions";

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
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no puede desconectar cuentas.</p>
        <Link href="/panel/conectar-ml">Volver</Link>
      </main>
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
  const cuenta = cuentas.find((c) => c.id === params.cuentaId);
  if (!cuenta) redirect("/panel/conectar-ml");

  const desconectar = desconectarCuentaAction.bind(null, params.cuentaId);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Desconectar {cuenta.nickname}</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>
        Al desconectar esta cuenta, Zilonix deja de traer pedidos, mensajes y stock nuevos de{" "}
        <strong>{cuenta.nickname}</strong>. Lo que ya se importó <strong>no se borra</strong> — sigue visible en el
        histórico. Puedes volver a conectarla cuando quieras.
      </p>
      <form action={desconectar} style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button type="submit" style={{ padding: "8px 14px", borderRadius: 6, fontSize: 14 }}>
          Sí, desconectar
        </button>
        <Link href="/panel/conectar-ml" style={{ fontSize: 14, alignSelf: "center" }}>
          Cancelar
        </Link>
      </form>
    </main>
  );
}
