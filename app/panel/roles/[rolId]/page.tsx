import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { ACCIONES, MODULOS, obtenerRolDeEmpresa } from "@/lib/roles";
import { guardarPermisosAction } from "./actions";

// Tarea 1.7 — "puede ajustar permisos por acción": una celda por
// módulo × acción, con el alcance (todo/propio) elegido en la misma
// celda. Avisar de permisos peligrosos antes de activarlos (ej.
// "autorizar" en finanzas) es la tarea 1.8 — acá se puede marcar
// cualquier combinación sin fricción, a propósito.
export default async function EditarRolPage({ params }: { params: { rolId: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  if (miMembresia?.rolNombre !== "Dueño") {
    return (
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "48px 24px" }}>
        <p>Solo el Dueño puede ajustar permisos.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const rol = await obtenerRolDeEmpresa(empresa.id, params.rolId);
  if (!rol) redirect("/panel/roles");
  if (rol.nombre === "Dueño") redirect("/panel/roles");

  const valorActual = (modulo: string, accion: string) =>
    rol.permisos.find((p) => p.modulo === modulo && p.accion === accion)?.alcance ?? "no";

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Permisos de {rol.nombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        "Propio" limita la acción a lo que esa misma persona creó — nunca a lo de todos.
      </p>

      <form action={guardarPermisosAction} style={{ marginTop: 20 }}>
        <input type="hidden" name="rolId" value={rol.id} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 6 }}>Módulo</th>
                {ACCIONES.map((accion) => (
                  <th key={accion} style={{ textAlign: "left", padding: 6, textTransform: "capitalize" }}>
                    {accion}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULOS.map((modulo) => (
                <tr key={modulo} style={{ borderTop: "1px solid currentColor" }}>
                  <td style={{ padding: 6, textTransform: "capitalize" }}>{modulo}</td>
                  {ACCIONES.map((accion) => (
                    <td key={accion} style={{ padding: 6 }}>
                      <select name={`permiso__${modulo}__${accion}`} defaultValue={valorActual(modulo, accion)}>
                        <option value="no">No</option>
                        <option value="todo">Todo</option>
                        <option value="propio">Propio</option>
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="submit" style={{ padding: "10px 16px", marginTop: 20 }}>
          Guardar permisos
        </button>
      </form>

      <Link href="/panel/roles" style={{ display: "inline-block", marginTop: 20, fontSize: 13 }}>
        ← Volver a roles
      </Link>
    </main>
  );
}
