import { notFound } from "next/navigation";
import { CapturasTicket } from "@/components/soporte/CapturasTicket";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { obtenerMiTicket } from "@/lib/soporte/tickets";
import { ETIQUETA_ESTADO_TICKET } from "@/lib/soporte/validacion";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { CHIP_ESTADO_TICKET, formatoFechaTicket } from "../formato";
import { FormMensaje } from "./FormMensaje";
import styles from "../page.module.css";

// Mismo candado que /panel/tickets. Un ticket de otra empresa da 404,
// igual que uno que no existe (la RLS no lo deja ver).
export default async function TicketPage({ params }: { params: { ticketId: string } }) {
  const { activa } = await obtenerContextoPanel();
  const ticket = await obtenerMiTicket(activa.id, params.ticketId);
  if (!ticket) notFound();

  return (
    <>
      <EncabezadoPagina titulo={ticket.asunto} descripcion={`${ticket.modulo} · ${ticket.autorNombre} · ${formatoFechaTicket(ticket.creadoTs)}`} />
      <div>
        <Chip estado={CHIP_ESTADO_TICKET[ticket.estado]}>{ETIQUETA_ESTADO_TICKET[ticket.estado]}</Chip>
      </div>

      <Tarjeta>
        <p className={styles.cuerpo}>{ticket.mensaje}</p>
        <CapturasTicket base="/api/soporte/imagen" ticketId={ticket.id} archivos={ticket.imagenes} />
      </Tarjeta>

      {ticket.mensajes.length > 0 && (
        <div>
          <h2 className={styles.tituloSeccion}>Conversación</h2>
          <ListaFilas>
            {ticket.mensajes.map((m) => (
              <FilaLista key={m.id}>
                <div className={styles.mensaje}>
                  <span className={styles.meta}>
                    {m.esSuperadmin ? "Soporte Zilonix" : m.autorNombre} · {formatoFechaTicket(m.creadoTs)}
                  </span>
                  <p className={styles.cuerpo}>{m.mensaje}</p>
                  <CapturasTicket base="/api/soporte/imagen" ticketId={ticket.id} archivos={m.imagenes} />
                </div>
              </FilaLista>
            ))}
          </ListaFilas>
        </div>
      )}

      {ticket.estado === "resuelto" ? (
        <p className={styles.aviso}>Este ticket está resuelto. Si el problema sigue, abre uno nuevo.</p>
      ) : (
        <Tarjeta>
          <FormMensaje ticketId={ticket.id} />
        </Tarjeta>
      )}

      <BotonLink href="/panel/tickets" variante="fantasma" className={styles.volver}>
        Volver a mis tickets
      </BotonLink>
    </>
  );
}
