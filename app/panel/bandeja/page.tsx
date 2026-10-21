import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarBandeja } from "@/lib/ml/bandeja";

const NOMBRE_TIPO: Record<string, string> = { pregunta: "Pregunta", mensaje: "Mensaje", reclamo: "Reclamo" };

// Tarea 2.9 — bandeja de atención: preguntas, mensajes y reclamos en
// una sola lista, lo vencido y sin responder primero (ver
// lib/ml/bandeja.ts, listarBandeja).
export default async function BandejaPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "atencion", "consultar");
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

  const items = await listarBandeja(empresa.id);
  const ahora = Date.now();

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, padding: "0 8px" }}>Bandeja de atención</h1>

      {items.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: 14, padding: "0 8px" }}>No hay nada en la bandeja todavía.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {items.map((item) => {
            const vencido = !item.respondida && item.vencePorResponderTs && new Date(item.vencePorResponderTs).getTime() < ahora;
            return (
              <li key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                <Link href={`/panel/bandeja/${item.id}`} style={{ display: "block", padding: "12px 8px", color: "inherit", textDecoration: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {NOMBRE_TIPO[item.tipo] ?? item.tipo}
                      {item.itemTitulo && <span style={{ fontWeight: 400, opacity: 0.7 }}> · {item.itemTitulo}</span>}
                    </span>
                    {!item.respondida && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: vencido ? "#fdecea" : "#fff8e1",
                          color: vencido ? "#b00020" : "#8a6500",
                        }}
                      >
                        {vencido ? "Vencido" : "Pendiente"}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{item.texto ?? "(ver conversación)"}</div>
                  <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                    {item.compradorNickname ?? "comprador"} · {item.recibidoTs ? new Date(item.recibidoTs).toLocaleString("es-CO") : ""}
                  </div>
                </Link>
              </li>
            );
          })}
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
