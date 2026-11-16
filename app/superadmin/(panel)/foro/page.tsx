import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { listarParaModerar } from "@/lib/foro";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Boton } from "@/components/marco/Boton";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { cambiarVisibilidadAction } from "./actions";

// Moderación del foro (14-nov) — lo último publicado, preguntas y
// respuestas juntas, incluso lo escondido. Esconder nunca borra: se
// puede volver a mostrar. Mismo estilo simple que /superadmin.
export default async function ModerarForoPage() {
  const usuario = { id: (await requiereSesionSuperadmin()).usuarioId };

  const publicaciones = await listarParaModerar(usuario.id);

  return (
    <>
      <EncabezadoPagina
        titulo="Moderar foro"
        descripcion="Las 100 publicaciones más recientes. Esconder no borra nada: se puede volver a mostrar."
      />

      {publicaciones.length === 0 ? (
        <EstadoVacio>Todavía no hay nada publicado en el foro.</EstadoVacio>
      ) : (
        publicaciones.map((p) => (
          <div key={`${p.tipo}-${p.id}`} style={{ opacity: p.ocultaTs ? 0.55 : 1 }}>
          <Tarjeta>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, flexWrap: "wrap" }}>
              <span>
                <strong>{p.tipo === "pregunta" ? "Pregunta" : "Respuesta"}</strong> · {p.autorNombre} ({p.autorEmail}) ·{" "}
                {p.creadoTs.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                {p.ocultaTs && " · ESCONDIDA"}
              </span>
              <form action={cambiarVisibilidadAction}>
                <input type="hidden" name="tipo" value={p.tipo} />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="ocultar" value={p.ocultaTs ? "0" : "1"} />
                <Boton type="submit" variante="secundario" chico>
                  {p.ocultaTs ? "Mostrar" : "Esconder"}
                </Boton>
              </form>
            </div>
            <p style={{ margin: "6px 0 0", fontWeight: 600, fontSize: 14 }}>
              {p.tipo === "respuesta" && "En: "}
              {p.titulo}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.cuerpo}</p>
            {p.imagenUrl && (
              <a href={p.imagenUrl} target="_blank" rel="noopener noreferrer">
                <img src={p.imagenUrl} alt="Imagen adjunta" style={{ marginTop: 8, maxWidth: 240, maxHeight: 180, objectFit: "contain", borderRadius: 4 }} />
              </a>
            )}
          </Tarjeta>
          </div>
        ))
      )}
    </>
  );
}
