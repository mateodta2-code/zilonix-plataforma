import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requiereSuperadmin, listarEmpresasConConteo, NoEsSuperadminError } from "@/lib/superadmin";

// Tarea 1.11 (decisión D8) — "ve empresas, plan, salud, errores. No
// ve datos de negocio." Hoy no hay plan/salud/errores todavía (eso
// llega con el piloto pagado, Fase 4) — lo real que se puede mostrar
// ahora es la lista de empresas con su conteo de miembros, siempre
// visible, nunca el detalle de quién es quién sin un acceso temporal.
export default async function SuperadminPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  try {
    await requiereSuperadmin(usuario.id);
  } catch (error) {
    if (!(error instanceof NoEsSuperadminError)) throw error;
    redirect("/panel");
  }

  const empresas = await listarEmpresasConConteo();

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Empresas en Zilonix</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Solo cifras agregadas — nunca el detalle de una empresa sin que ella te conceda un acceso temporal.
      </p>

      {empresas.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 24 }}>Todavía no hay ninguna empresa registrada.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {empresas.map((e) => (
            <li
              key={e.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                border: "1px solid currentColor",
                borderRadius: 6,
              }}
            >
              <span>
                {e.nombre} <span style={{ opacity: 0.5, fontSize: 12.5 }}>NIT {e.nit}</span>
              </span>
              <span style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
                <span>
                  {e.miembros} miembro{e.miembros === 1 ? "" : "s"}
                </span>
                <Link href={`/superadmin/${e.id}`}>Ver →</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
