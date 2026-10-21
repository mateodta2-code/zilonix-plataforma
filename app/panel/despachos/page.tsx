import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarDespachosPendientes } from "@/lib/ml/despachos";

const ETIQUETA_LOGISTIC_TYPE: Record<string, string> = {
  self_service: "Flex",
  xd_drop_off: "Places",
  cross_docking: "Colecta",
  fulfillment: "Full",
  otro: "Otro",
};

// Tarea 2.10 — lista de despachos listos para imprimir (celular
// primero), con selección múltiple para la impresión masiva. Full
// nunca aparece acá (ver lib/ml/despachos.ts: nunca queda marcado
// imprimible — Mercado Libre rechaza esa guía, no aplica despacho
// físico).
export default async function DespachosPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const pendientes = await listarDespachosPendientes(empresa.id);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, padding: "0 8px" }}>Despachos pendientes</h1>

      {pendientes.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: 14, padding: "0 8px" }}>No hay despachos pendientes de imprimir.</p>
      ) : (
        <form action="/api/ml/despachos/etiquetas" method="POST" target="_blank">
          <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
            {pendientes.map((d) => (
              <li key={d.id} style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked />
                  <span style={{ flex: 1 }}>
                    Envío #{d.shipmentIdExterno}
                    <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>
                      {ETIQUETA_LOGISTIC_TYPE[d.logisticType ?? "otro"] ?? d.logisticType}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            style={{ marginTop: 16, padding: "10px 16px", background: "#000", color: "#fff", borderRadius: 6, fontSize: 14, border: "none" }}
          >
            Imprimir etiquetas seleccionadas
          </button>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            Si hay despachos de varias cuentas de Mercado Libre, selecciona primero los de una sola cuenta.
          </p>
        </form>
      )}

      <p style={{ marginTop: 24, padding: "0 8px" }}>
        <Link href="/panel/pedidos" style={{ fontSize: 13 }}>
          Volver a pedidos
        </Link>
      </p>
    </main>
  );
}
