import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerItemConHilo, listarMiembrosParaAsignar } from "@/lib/ml/bandeja";
import { responderAction, asignarAction } from "./actions";

const NOMBRE_TIPO: Record<string, string> = { pregunta: "Pregunta", mensaje: "Mensaje de venta", reclamo: "Reclamo" };

export default async function BandejaItemPage({ params }: { params: { id: string } }) {
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
        <Link href="/panel/bandeja">Volver</Link>
      </main>
    );
  }

  const resultado = await obtenerItemConHilo(empresa.id, params.id);
  if (!resultado) redirect("/panel/bandeja");
  const { item, hilo } = resultado;
  const miembros = await listarMiembrosParaAsignar(empresa.id);

  const responder = responderAction.bind(null, item.id);
  const asignar = asignarAction.bind(null, item.id);

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>{NOMBRE_TIPO[item.tipo] ?? item.tipo}</h1>
      {item.itemTitulo && (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          {item.itemPermalink ? (
            <a href={item.itemPermalink} target="_blank" rel="noreferrer">
              {item.itemTitulo}
            </a>
          ) : (
            item.itemTitulo
          )}
        </p>
      )}
      <p style={{ fontSize: 13, opacity: 0.6 }}>Comprador: {item.compradorNickname ?? "—"}</p>

      <form action={asignar} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
        <label htmlFor="operadorId">Asignado a</label>
        <select id="operadorId" name="operadorId" defaultValue={item.asignadoA ?? ""} style={{ padding: 6 }}>
          <option value="">Sin asignar</option>
          {miembros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        <button type="submit" style={{ padding: "4px 10px" }}>
          Guardar
        </button>
      </form>

      <div style={{ marginTop: 20, borderTop: "1px solid #eee", paddingTop: 16 }}>
        {item.tipo === "mensaje" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hilo.map((m) => (
              <div key={m.id} style={{ alignSelf: m.deComprador ? "flex-start" : "flex-end", maxWidth: "80%" }}>
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: m.deComprador ? "#f0f0f0" : "#000",
                    color: m.deComprador ? "#000" : "#fff",
                    fontSize: 14,
                  }}
                >
                  {m.texto}
                </div>
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{new Date(m.ts).toLocaleString("es-CO")}</div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14 }}>{item.texto}</p>
            <p style={{ fontSize: 12, opacity: 0.5 }}>{item.ocurridoTs ? new Date(item.ocurridoTs).toLocaleString("es-CO") : ""}</p>
          </>
        )}
      </div>

      {item.respondida ? (
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.6 }}>Ya respondido.</p>
      ) : (
        <form action={responder} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <textarea name="texto" required rows={3} placeholder="Escribe la respuesta…" style={{ padding: 8, fontFamily: "inherit" }} />
          <button type="submit" style={{ padding: "8px 14px", alignSelf: "flex-start" }}>
            Responder
          </button>
        </form>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/bandeja" style={{ fontSize: 13 }}>
          Volver a la bandeja
        </Link>
      </p>
    </main>
  );
}
