import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { listarMisTickets } from "@/lib/soporte/tickets";
import { ETIQUETA_ESTADO_TICKET } from "@/lib/soporte/validacion";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormTicket } from "./FormTicket";
import { CHIP_ESTADO_TICKET, formatoFechaTicket } from "./formato";
import styles from "./page.module.css";

// Issue #623 — tickets de soporte. Permiso: cualquier miembro de la
// empresa activa (no hay módulo "tickets" en los roles); el candado es
// obtenerContextoPanel() y la RLS por empresa de tickets_soporte.
export default async function TicketsPage() {
  const { activa } = await obtenerContextoPanel();
  const tickets = await listarMisTickets(activa.id);

  return (
    <>
      <EncabezadoPagina titulo="Tickets de soporte" descripcion="Cuéntanos tu problema y el equipo de Zilonix te responde acá. Solo ven el ticket, no tus ventas ni tus clientes." />

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Abrir ticket</h2>
        <FormTicket />
      </Tarjeta>

      <div>
        <h2 className={styles.tituloSeccion}>Mis tickets</h2>
        {tickets.length === 0 ? (
          <EstadoVacio>Todavía no has abierto ningún ticket.</EstadoVacio>
        ) : (
          <ListaFilas>
            {tickets.map((t) => (
              <FilaLista key={t.id}>
                <Link href={`/panel/tickets/${t.id}`} className={styles.fila}>
                  <span className={styles.asunto}>
                    {t.asunto}
                    <span className={styles.meta}>
                      {t.modulo} · {formatoFechaTicket(t.creadoTs)}
                    </span>
                  </span>
                  <Chip estado={CHIP_ESTADO_TICKET[t.estado]}>{ETIQUETA_ESTADO_TICKET[t.estado]}</Chip>
                </Link>
              </FilaLista>
            ))}
          </ListaFilas>
        )}
      </div>
    </>
  );
}
