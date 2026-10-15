import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarAuditoriaDeEmpresa } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Tarea 1.9 — "Ves en Actividad las 5 acciones con tu nombre y hora;
// una venta sincronizada automáticamente aparece con actor
// 'Integración ML', no con el nombre de una persona". Hoy no hay
// ninguna integración real todavía (eso es Fase 2), así que la parte
// de "sistema" de este criterio queda probada en
// db/auditoria.test.ts contra Postgres real, no en esta pantalla con
// un dato inventado — una fila falsa de "Integración ML" acá se vería
// como un dato real de la empresa y no lo es.
export default async function ActividadPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol no puede ver la actividad de {empresa.nombre}.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const filas = await listarAuditoriaDeEmpresa(empresa.id);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Actividad de {empresa.nombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>Quién hizo qué, cuándo — nunca se le atribuye a una persona lo que hizo una integración.</p>

      {filas.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 24 }}>Todavía no hay actividad registrada.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 6 }}>Cuándo</th>
                <th style={{ padding: 6 }}>Quién</th>
                <th style={{ padding: 6 }}>Acción</th>
                <th style={{ padding: 6 }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid currentColor" }}>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>{new Date(f.ts).toLocaleString("es-CO")}</td>
                  <td style={{ padding: 6, opacity: f.actorTipo === "sistema" ? 0.7 : 1, fontStyle: f.actorTipo === "sistema" ? "italic" : "normal" }}>
                    {f.actorNombre}
                  </td>
                  <td style={{ padding: 6 }}>
                    {f.accion} · {f.entidad}
                  </td>
                  <td style={{ padding: 6 }}>{f.detalle ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Link href="/panel" style={{ display: "inline-block", marginTop: 24, fontSize: 13 }}>
        Volver al panel
      </Link>
    </main>
  );
}
