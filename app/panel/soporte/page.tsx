import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarAccesosDeEmpresa } from "@/lib/acceso-temporal";
import { concederAccesoAction, revocarAccesoAction } from "./actions";

// Tarea 1.11 (decisión D8) — el lado de la empresa: "El personal de
// Zilonix no ve tus ventas ni tus clientes sin tu permiso." Esta
// pantalla ES ese permiso — explícito, con fecha de vencimiento y
// diciendo qué va a ver soporte, no un interruptor genérico
// "sí/no" (evidencia real, Olist Tiny: les falta decir exactamente
// qué ve ese acceso — acá "alcance" es obligatorio).
export default async function SoportePage() {
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
        <p>Tu rol no puede gestionar el acceso de soporte.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const accesos = await listarAccesosDeEmpresa(empresa.id);
  const ahora = Date.now();

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Acceso de soporte — {empresa.nombre}</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Por defecto, el equipo de Zilonix solo ve cuántos miembros tiene tu empresa — nunca quiénes son, ni ningún otro
        dato, sin que tú concedas un acceso temporal acá.
      </p>

      <form action={concederAccesoAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <label style={{ fontSize: 13 }}>
          ¿Qué puede ver soporte? (sé específico)
          <input
            name="alcance"
            required
            placeholder='ej. "Ver quién trabaja en la empresa, para resolver un ticket"'
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Vence en (horas, máximo 360 = 15 días)
          <input
            type="number"
            name="horas"
            defaultValue={48}
            min={1}
            max={360}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>
        <button type="submit" style={{ padding: "10px 16px", marginTop: 4 }}>
          Conceder acceso temporal
        </button>
      </form>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 28 }}>Historial</h2>
      {accesos.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 13 }}>Nunca se ha concedido ningún acceso.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {accesos.map((a) => {
            const vencido = a.expiraTs.getTime() <= ahora;
            const activo = !a.revocadoTs && !vencido;
            return (
              <li
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  border: "1px solid currentColor",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <span>
                  {a.alcance}
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    {activo ? "activo" : a.revocadoTs ? "revocado" : "vencido"} · vence {a.expiraTs.toLocaleString("es-CO")}
                  </span>
                </span>
                {activo && (
                  <form action={revocarAccesoAction}>
                    <input type="hidden" name="accesoId" value={a.id} />
                    <button type="submit" style={{ fontSize: 12 }}>
                      Revocar
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/panel" style={{ display: "inline-block", marginTop: 24, fontSize: 13 }}>
        Volver al panel
      </Link>
    </main>
  );
}
