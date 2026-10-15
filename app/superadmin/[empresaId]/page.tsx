import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import {
  requiereSuperadmin,
  listarEmpresasConConteo,
  obtenerMiembrosConAcceso,
  NoEsSuperadminError,
  SinAccesoTemporalError,
} from "@/lib/superadmin";

// Tarea 1.11 (decisión D8) — el criterio de "listo" de esta tarea,
// literal: como superadmin ves "Empresa X — N miembros" siempre, pero
// el detalle (quién es quién) solo si la empresa concedió un acceso
// temporal activo. Cada vista de detalle exitosa queda en auditoria
// (lib/superadmin.ts) — eso no se ve acá, lo prueba db/superadmin.test.ts
// contra Postgres real.
export default async function SuperadminEmpresaPage({ params }: { params: { empresaId: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  try {
    await requiereSuperadmin(usuario.id);
  } catch (error) {
    if (!(error instanceof NoEsSuperadminError)) throw error;
    redirect("/panel");
  }

  const empresas = await listarEmpresasConConteo();
  const empresa = empresas.find((e) => e.id === params.empresaId);
  if (!empresa) redirect("/superadmin");

  let miembros: { nombre: string; email: string; rolNombre: string }[] | null = null;
  let sinAcceso = false;
  try {
    miembros = await obtenerMiembrosConAcceso(empresa.id, usuario.id);
  } catch (error) {
    if (!(error instanceof SinAccesoTemporalError)) throw error;
    sinAcceso = true;
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <Link href="/superadmin" style={{ fontSize: 13 }}>
        ← Todas las empresas
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{empresa.nombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        NIT {empresa.nit} · {empresa.miembros} miembro{empresa.miembros === 1 ? "" : "s"}
      </p>

      {sinAcceso ? (
        <p style={{ marginTop: 24, fontSize: 14, opacity: 0.8 }}>
          Esta empresa no te ha concedido ningún acceso temporal activo — no se puede ver más detalle que el conteo de
          arriba.
        </p>
      ) : (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 24 }}>Miembros (vista con acceso temporal)</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 6 }}>Nombre</th>
                <th style={{ padding: 6 }}>Correo</th>
                <th style={{ padding: 6 }}>Rol</th>
              </tr>
            </thead>
            <tbody>
              {miembros!.map((m, i) => (
                <tr key={i} style={{ borderTop: "1px solid currentColor" }}>
                  <td style={{ padding: 6 }}>{m.nombre}</td>
                  <td style={{ padding: 6 }}>{m.email}</td>
                  <td style={{ padding: 6 }}>{m.rolNombre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
