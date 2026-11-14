import { notFound } from "next/navigation";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { obtenerPregunta } from "@/lib/foro";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { formatoFechaForo } from "../formato";
import { FormRespuesta } from "./FormRespuesta";
import styles from "../page.module.css";

// Mismo candado que /panel/foro (obtenerContextoPanel). Una pregunta
// escondida por moderación da 404, igual que una que no existe.
export default async function PreguntaForoPage({ params }: { params: { preguntaId: string } }) {
  await obtenerContextoPanel();
  const pregunta = await obtenerPregunta(params.preguntaId);
  if (!pregunta) notFound();

  return (
    <>
      <EncabezadoPagina titulo={pregunta.titulo} descripcion={`${pregunta.autorNombre} · ${formatoFechaForo(pregunta.creadoTs)}`} />

      <Tarjeta>
        <p className={styles.cuerpo}>{pregunta.cuerpo}</p>
        {pregunta.imagenUrl && <FotoConZoom src={pregunta.imagenUrl} alt={`Imagen de la pregunta: ${pregunta.titulo}`} claseMiniatura={styles.imagenPublicacion} />}
      </Tarjeta>

      <div>
        <h2 className={styles.tituloSeccion}>
          {pregunta.respuestas.length} {pregunta.respuestas.length === 1 ? "respuesta" : "respuestas"}
        </h2>
        {pregunta.respuestas.length === 0 ? (
          <EstadoVacio>Nadie ha respondido todavía. Si sabes algo, ¡ayuda!</EstadoVacio>
        ) : (
          <ListaFilas>
            {pregunta.respuestas.map((r) => (
              <FilaLista key={r.id}>
                <div className={styles.respuesta}>
                  <span className={styles.meta}>
                    {r.autorNombre} · {formatoFechaForo(r.creadoTs)}
                  </span>
                  <p className={styles.cuerpo}>{r.cuerpo}</p>
                  {r.imagenUrl && <FotoConZoom src={r.imagenUrl} alt={`Imagen de la respuesta de ${r.autorNombre}`} claseMiniatura={styles.imagenPublicacion} />}
                </div>
              </FilaLista>
            ))}
          </ListaFilas>
        )}
      </div>

      <Tarjeta>
        <FormRespuesta preguntaId={pregunta.id} />
      </Tarjeta>

      <BotonLink href="/panel/foro" variante="fantasma" chico className={styles.volver}>
        Volver al foro
      </BotonLink>
    </>
  );
}
