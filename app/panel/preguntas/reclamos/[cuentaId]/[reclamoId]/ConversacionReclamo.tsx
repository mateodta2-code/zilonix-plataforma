import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { iniciales, type DetalleReclamoMl, type MensajeReclamo } from "@/lib/ml/reclamos";
import { datosSitioMl } from "@/lib/ml/sitios";
import { rotuloRolReclamo } from "@/lib/preguntas/tiempo";
import styles from "./DetalleReclamo.module.css";

// Misma zona que formatearFechaPedido (lib/pedidos/marketplace.ts): el
// idioma sale del sitio de la cuenta, nunca fijo.
const ZONA = "America/Bogota";

function formatear(fecha: string | null, idioma: string, opciones: Intl.DateTimeFormatOptions): string {
  const ms = fecha ? Date.parse(fecha) : NaN;
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: ZONA }).format(new Date(ms)) : "";
}

function claveDia(fecha: string | null): string {
  const ms = fecha ? Date.parse(fecha) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString("en-CA", { timeZone: ZONA }) : "";
}

function esImagen(tipo: string | null, archivo: string): boolean {
  return (tipo ?? "").startsWith("image/") || /\.(jpe?g|png)$/i.test(archivo);
}

export function ConversacionReclamo({
  detalle,
  cuentaId,
  siteId,
  ahora,
}: {
  detalle: DetalleReclamoMl;
  cuentaId: string;
  siteId: string | null;
  ahora: Date;
}) {
  const idioma = datosSitioMl(siteId).idioma;
  const { reclamo, mensajes, motivo, reputacion } = detalle;
  const urlAdjunto = (archivo: string) => `/api/ml/reclamos/${cuentaId}/${reclamo.id}/adjuntos/${encodeURIComponent(archivo)}`;
  const hoy = claveDia(ahora.toISOString());
  const etiquetaDia = (fecha: string | null) =>
    claveDia(fecha) === hoy ? "Hoy" : formatear(fecha, idioma, { dateStyle: "long" });

  let diaPrevio = "";
  return (
    <section className={styles.conversacion} aria-label="Conversación del reclamo">
      <header className={styles.comprador}>
        <span className={styles.avatar} aria-hidden="true">
          {iniciales(detalle.compradorNombre)}
        </span>
        <span className={styles.compradorNombre}>{detalle.compradorNombre}</span>
      </header>

      {reclamo.etapa === "dispute" && <p className={styles.mediacion}>En mediación: Mercado Libre recibe tus mensajes.</p>}

      <div className={styles.franja}>
        <span>
          Reclamo abierto n.º {reclamo.id}
          {reputacion?.afecta === true ? " | Afecta tu reputación" : reputacion?.afecta === false ? " | No afectó tu reputación" : ""}
        </span>
        {(motivo?.detalle ?? motivo?.nombre ?? reclamo.motivoId) && <p className={styles.franjaMotivo}>{motivo?.detalle ?? motivo?.nombre ?? reclamo.motivoId}</p>}
      </div>

      {mensajes.length === 0 && <p className={styles.vacio}>Todavía no hay mensajes en este reclamo.</p>}
      <ol className={styles.mensajes}>
        {mensajes.map((m: MensajeReclamo, i) => {
          const dia = claveDia(m.fecha);
          const separador = dia && dia !== diaPrevio;
          if (dia) diaPrevio = dia;
          const clase = m.rolEmisor === "respondent" ? styles.burbujaVendedor : m.rolEmisor === "mediator" ? styles.burbujaMediador : styles.burbujaComprador;
          return (
            <li key={`${m.fecha}-${i}`} className={styles.mensajeFila}>
              {separador && <p className={styles.separadorDia}>{etiquetaDia(m.fecha)}</p>}
              <div className={`${styles.burbuja} ${clase}`}>
                {m.rolEmisor === "mediator" && <span className={styles.rolMediador}>{rotuloRolReclamo(m.rolEmisor)}</span>}
                {/* Texto plano: lo escribió un tercero, nunca HTML. */}
                {m.texto && <p className={styles.textoMensaje}>{m.texto}</p>}
                {m.adjuntos.map((a) =>
                  esImagen(a.tipo, a.archivo) ? (
                    <FotoConZoom key={a.archivo} src={urlAdjunto(a.archivo)} alt={a.nombre} claseMiniatura={styles.miniatura} />
                  ) : (
                    <a key={a.archivo} href={urlAdjunto(a.archivo)} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                      {a.nombre}
                    </a>
                  )
                )}
                <span className={styles.hora}>{formatear(m.fecha, idioma, { timeStyle: "short" })}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
