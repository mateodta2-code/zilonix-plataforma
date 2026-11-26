import { notFound } from "next/navigation";
import { CapturasTicket } from "@/components/soporte/CapturasTicket";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { obtenerTicketParaAtender } from "@/lib/soporte/superadmin";
import { ETIQUETA_ESTADO_TICKET } from "@/lib/soporte/validacion";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { CHIP_ESTADO_TICKET, formatoFechaTicket } from "@/app/panel/tickets/formato";
import styles from "@/app/panel/tickets/page.module.css";
import { FormAtender } from "./FormAtender";

export default async function TicketSuperadminPage({ params }: { params: { ticketId: string } }) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const ticket = await obtenerTicketParaAtender(usuarioId, params.ticketId);
  if (!ticket) notFound();

  return (
    <>
      <EncabezadoPagina
        titulo={ticket.asunto}
        descripcion={`${ticket.empresaNombre} · ${ticket.modulo} · ${ticket.autorNombre} · ${formatoFechaTicket(ticket.creadoTs)}`}
      />
      <div>
        <Chip estado={CHIP_ESTADO_TICKET[ticket.estado]}>{ETIQUETA_ESTADO_TICKET[ticket.estado]}</Chip>
      </div>

      <Tarjeta>
        <p className={styles.cuerpo}>{ticket.mensaje}</p>
        <CapturasTicket base="/api/superadmin/soporte/imagen" ticketId={ticket.id} archivos={ticket.imagenes} />
      </Tarjeta>

      {ticket.mensajes.length > 0 && (
        <div>
          <h2 className={styles.tituloSeccion}>Conversación</h2>
          <ListaFilas>
            {ticket.mensajes.map((m) => (
              <FilaLista key={m.id}>
                <div className={styles.mensaje}>
                  <span className={styles.meta}>
                    {m.esSuperadmin ? `Soporte Zilonix (${m.autorNombre})` : m.autorNombre} · {formatoFechaTicket(m.creadoTs)}
                  </span>
                  <p className={styles.cuerpo}>{m.mensaje}</p>
                  <CapturasTicket base="/api/superadmin/soporte/imagen" ticketId={ticket.id} archivos={m.imagenes} />
                </div>
              </FilaLista>
            ))}
          </ListaFilas>
        </div>
      )}

      <Tarjeta>
        <FormAtender ticketId={ticket.id} estado={ticket.estado} />
      </Tarjeta>

      <BotonLink href="/superadmin/soporte" variante="fantasma" className={styles.volver}>
        Volver a soporte
      </BotonLink>
    </>
  );
}
