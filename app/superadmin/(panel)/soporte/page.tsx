import Link from "next/link";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { filtroEstadoValido, listarTodosLosTickets } from "@/lib/soporte/superadmin";
import { ESTADOS_TICKET, ETIQUETA_ESTADO_TICKET } from "@/lib/soporte/validacion";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { CHIP_ESTADO_TICKET, formatoFechaTicket } from "@/app/panel/tickets/formato";
import styles from "@/app/panel/tickets/page.module.css";

// Issue #623, parte 2 — tickets de todas las empresas. Solo asunto,
// empresa, estado y fecha (D8): nada más de la empresa.
export default async function SoporteSuperadminPage({ searchParams }: { searchParams: { estado?: string } }) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const estado = filtroEstadoValido(searchParams.estado);
  const tickets = await listarTodosLosTickets(usuarioId, estado);

  return (
    <>
      <EncabezadoPagina titulo="Soporte" descripcion="Tickets de todas las empresas. Solo ves el ticket y su conversación, nunca otros datos de la empresa." />

      <div className={styles.acciones}>
        <BotonLink href="/superadmin/soporte" variante={estado ? "fantasma" : "primario"}>
          Todos
        </BotonLink>
        {ESTADOS_TICKET.map((e) => (
          <BotonLink key={e} href={`/superadmin/soporte?estado=${e}`} variante={estado === e ? "primario" : "fantasma"}>
            {ETIQUETA_ESTADO_TICKET[e]}
          </BotonLink>
        ))}
      </div>

      {tickets.length === 0 ? (
        <EstadoVacio>No hay tickets{estado ? ` en estado «${ETIQUETA_ESTADO_TICKET[estado]}»` : ""}.</EstadoVacio>
      ) : (
        <ListaFilas>
          {tickets.map((t) => (
            <FilaLista key={t.id}>
              <Link href={`/superadmin/soporte/${t.id}`} className={styles.fila}>
                <span className={styles.asunto}>
                  {t.asunto}
                  <span className={styles.meta}>
                    {t.empresaNombre} · {t.modulo} · {formatoFechaTicket(t.actualizadoTs)}
                  </span>
                </span>
                <Chip estado={CHIP_ESTADO_TICKET[t.estado]}>{ETIQUETA_ESTADO_TICKET[t.estado]}</Chip>
              </Link>
            </FilaLista>
          ))}
        </ListaFilas>
      )}
    </>
  );
}
