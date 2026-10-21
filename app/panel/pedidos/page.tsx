import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarPedidos } from "@/lib/ml/pedidos";

// Tarea 2.7 — "lista de pedidos (celular primero)": una sola columna,
// cada pedido como una fila completa (nunca una tabla ancha que obliga
// a hacer scroll horizontal en un celular).
export default async function PedidosPage() {
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

  const pedidos = await listarPedidos(empresa.id);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Pedidos</h1>
        <Link href="/panel/despachos" style={{ fontSize: 13 }}>
          Despachos
        </Link>
      </div>

      {pedidos.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: 14, padding: "0 8px" }}>
          Todavía no hay pedidos importados — conecta una cuenta de Mercado Libre en{" "}
          <Link href="/panel/conectar-ml">Conectar Mercado Libre</Link>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {pedidos.map((pedido) => (
            <li key={pedido.id} style={{ borderBottom: "1px solid #eee" }}>
              <Link
                href={`/panel/pedidos/${pedido.id}`}
                style={{ display: "block", padding: "14px 8px", color: "inherit", textDecoration: "none" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span>#{pedido.pedidoIdExterno}</span>
                  <span>
                    {pedido.moneda} {pedido.total}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                  <span>{new Date(pedido.fecha).toLocaleString("es-CO")}</span>
                  <span style={{ textTransform: "capitalize" }}>{pedido.estado}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 24, padding: "0 8px" }}>
        <Link href="/panel" style={{ fontSize: 13 }}>
          Volver al panel
        </Link>
      </p>
    </main>
  );
}
