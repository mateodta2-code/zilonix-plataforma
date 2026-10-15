import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { decodificarPermisos, esPeligroso, obtenerRolDeEmpresa } from "@/lib/roles";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { confirmarPermisosAction } from "../actions";

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
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol no puede ajustar permisos.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const rol = await obtenerRolDeEmpresa(empresa.id, params.rolId);
  if (!rol) redirect("/panel/roles");

  const pendiente = searchParams.pendiente ?? "";
  const propuestos = decodificarPermisos(pendiente);
  const peligrosos = propuestos.filter((p) => esPeligroso(p.modulo, p.accion));

  if (peligrosos.length === 0) redirect(`/panel/roles/${rol.id}`);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Confirma estos permisos</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Le vas a dar a <b>{rol.nombre}</b> permisos que pueden cambiar cosas sensibles de la empresa:
      </p>
      <ul style={{ color: "#a8432f", fontSize: 14 }}>
        {peligrosos.map((p, i) => (
          <li key={i}>
            {p.accion} en {p.modulo} ({p.alcance})
          </li>
        ))}
      </ul>

      <form action={confirmarPermisosAction} style={{ marginTop: 20, display: "flex", gap: 12 }}>
        <input type="hidden" name="rolId" value={rol.id} />
        <input type="hidden" name="pendiente" value={pendiente} />
        <button type="submit" style={{ padding: "10px 16px" }}>
          Sí, confirmo estos permisos
        </button>
        <Link
          href={`/panel/roles/${rol.id}`}
          style={{ padding: "10px 16px", border: "1px solid currentColor", borderRadius: 6 }}
        >
          Cancelar
        </Link>
      </form>
    </main>
  );
}
