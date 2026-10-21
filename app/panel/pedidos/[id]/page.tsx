import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerPedidoConEventos, PASOS_PEDIDO, type EventoPedido, type PasoPedido } from "@/lib/ml/pedidos";

const NOMBRE_PASO: Record<PasoPedido, string> = {
  venta: "Venta",
  pago: "Pago",
  factura: "Factura",
  empaque: "Empaque",
  despacho: "Despacho",
  entrega: "Entrega",
  novedades: "Novedades",
  dinero_conciliado: "Dinero conciliado",
};

// Tarea 2.7 — línea de tiempo de los 8 pasos del plan maestro, siempre
// en el mismo orden, con o sin evento. Nunca un volcado de JSON crudo
// (evidencia real de Effi, docs/investigacion/effi.md sección H) —
// cada paso es una frase legible con fecha, hora y quién.
export default async function PedidoDetallePage({ params }: { params: { id: string } }) {
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
        <Link href="/panel/pedidos">Volver</Link>
      </main>
    );
  }

  const resultado = await obtenerPedidoConEventos(empresa.id, params.id);
  if (!resultado) redirect("/panel/pedidos");
  const { pedido, eventos } = resultado;
  const eventoPorPaso = new Map<PasoPedido, EventoPedido>(eventos.map((e) => [e.paso, e]));

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Pedido #{pedido.pedidoIdExterno}</h1>
      <p style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
        {pedido.moneda} {pedido.total} · {pedido.estado}
      </p>

      <ol style={{ listStyle: "none", padding: 0, marginTop: 24 }}>
        {PASOS_PEDIDO.map((paso) => {
          const evento = eventoPorPaso.get(paso);
          return (
            <li key={paso} style={{ display: "flex", gap: 12, paddingBottom: 16 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  marginTop: 5,
                  flexShrink: 0,
                  background: evento ? "#2e7d32" : "transparent",
                  border: evento ? "none" : "2px solid #ccc",
                }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: evento ? 600 : 400, opacity: evento ? 1 : 0.5 }}>{NOMBRE_PASO[paso]}</div>
                {evento ? (
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {new Date(evento.ts).toLocaleString("es-CO")} · {evento.actorTipo === "sistema" ? "Sistema / integración ML" : "Persona"}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.5 }}>Pendiente</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p style={{ marginTop: 16 }}>
        <Link href="/panel/pedidos" style={{ fontSize: 13 }}>
          Volver a pedidos
        </Link>
      </p>
    </main>
  );
}
