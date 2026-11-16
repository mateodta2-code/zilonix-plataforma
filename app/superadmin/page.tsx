import Link from "next/link";
import { requiereSesionSuperadmin, listarEmpresasConConteo, PLANES, ESTADOS_EMPRESA } from "@/lib/superadmin";

// Tarea 1.11 (decisión D8) + PR B — solo cifras agregadas por empresa:
// plan, estado, miembros, cuentas conectadas y última actividad. Nunca
// productos, pedidos ni compradores. Buscador y filtros: GET con
// searchParams, el filtrado se hace acá en el servidor.
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: { q?: string; estado?: string; plan?: string };
}) {
  await requiereSesionSuperadmin();

  const q = (searchParams.q ?? "").trim().toLowerCase();
  const estado = (ESTADOS_EMPRESA as readonly string[]).includes(searchParams.estado ?? "") ? searchParams.estado : "";
  const plan = (PLANES as readonly string[]).includes(searchParams.plan ?? "") ? searchParams.plan : "";

  const todas = await listarEmpresasConConteo();
  const empresas = todas.filter(
    (e) => (!q || e.nombre.toLowerCase().includes(q)) && (!estado || e.estado === estado) && (!plan || e.plan === plan)
  );
  const celda = { padding: 6 } as const;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Empresas en Zilonix</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Solo cifras agregadas — nunca el detalle de una empresa sin que ella te conceda un acceso temporal.
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Buscar por nombre" aria-label="Buscar por nombre" />
        <select name="estado" defaultValue={estado} aria-label="Estado">
          <option value="">Todos los estados</option>
          {ESTADOS_EMPRESA.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select name="plan" defaultValue={plan} aria-label="Plan">
          <option value="">Todos los planes</option>
          {PLANES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <button type="submit">Filtrar</button>
      </form>

      {empresas.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 24 }}>No hay empresas que coincidan.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 20 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={celda}>Nombre</th>
              <th style={celda}>Alta</th>
              <th style={celda}>Plan</th>
              <th style={celda}>Estado</th>
              <th style={celda}>Miembros</th>
              <th style={celda}>Cuentas ML</th>
              <th style={celda}>Cuentas Falabella</th>
              <th style={celda}>Última actividad</th>
              <th style={celda} />
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid currentColor" }}>
                <td style={celda}>{e.nombre}</td>
                <td style={celda}>{fecha(e.creadoTs)}</td>
                <td style={celda}>{e.plan}</td>
                <td style={celda}>{e.estado}</td>
                <td style={celda}>{e.miembros}</td>
                <td style={celda}>{e.cuentasMl}</td>
                <td style={celda}>{e.cuentasFalabella}</td>
                <td style={celda}>{fecha(e.ultimaActividad)}</td>
                <td style={celda}>
                  <Link href={`/superadmin/${e.id}`}>Ver →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
