import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requiereSuperadmin, NoEsSuperadminError } from "@/lib/superadmin";
import { listarParaModerar } from "@/lib/foro";
import { cambiarVisibilidadAction } from "./actions";

// Moderación del foro (14-nov) — lo último publicado, preguntas y
// respuestas juntas, incluso lo escondido. Esconder nunca borra: se
// puede volver a mostrar. Mismo estilo simple que /superadmin.
export default async function ModerarForoPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  try {
    await requiereSuperadmin(usuario.id);
  } catch (error) {
    if (!(error instanceof NoEsSuperadminError)) throw error;
    redirect("/panel");
  }

  const publicaciones = await listarParaModerar(usuario.id);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ fontSize: 13 }}>
        <Link href="/superadmin">← Empresas</Link>
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Moderar el foro</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>Las 100 publicaciones más recientes. Esconder no borra nada: se puede volver a mostrar.</p>

      {publicaciones.length === 0 ? (
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 24 }}>Todavía no hay nada publicado en el foro.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {publicaciones.map((p) => (
            <li
              key={`${p.tipo}-${p.id}`}
              style={{ padding: "10px 14px", border: "1px solid currentColor", borderRadius: 6, opacity: p.ocultaTs ? 0.55 : 1 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                <span>
                  <strong>{p.tipo === "pregunta" ? "Pregunta" : "Respuesta"}</strong> · {p.autorNombre} ({p.autorEmail}) ·{" "}
                  {p.creadoTs.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                  {p.ocultaTs && " · ESCONDIDA"}
                </span>
                <form action={cambiarVisibilidadAction}>
                  <input type="hidden" name="tipo" value={p.tipo} />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="ocultar" value={p.ocultaTs ? "0" : "1"} />
                  <button type="submit">{p.ocultaTs ? "Mostrar" : "Esconder"}</button>
                </form>
              </div>
              <p style={{ margin: "6px 0 0", fontWeight: 600, fontSize: 14 }}>
                {p.tipo === "respuesta" && "En: "}
                {p.titulo}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.cuerpo}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
