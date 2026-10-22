import { urlPublicaBase } from "@/lib/url-publica";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import styles from "./page.module.css";

// Tarea 1.7 — todavía no hay proveedor de correo decidido (D pendiente,
// fuera de esta tarea), así que el link se muestra en pantalla para
// que el Dueño lo copie y lo mande él mismo. El token nunca se guarda
// en ningún lado fuera de la base ni se expone por otra ruta.
export default function InvitacionListaPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  const link = token ? `${urlPublicaBase()}/invitacion/${token}` : null;

  return (
    <>
      <EncabezadoPagina titulo="Invitación generada" descripcion="Comparte este link con la persona — solo funciona una vez y vence en 7 días." />
      {link ? (
        // Tarea 1.12 — bug real encontrado en vivo en staging: esto es
        // un Server Component (sin "use client"), y un <input> con
        // onFocus ahí reventaba en producción ("Event handlers cannot
        // be passed to Client Component props") justo al generar una
        // invitación — ni el build ni el typecheck lo atraparon,
        // porque esta ruta es dinámica y nunca se renderizó de verdad
        // hasta que alguien hizo clic en "Generar invitación". Se
        // quita el onFocus (era solo una comodidad de selección
        // automática al hacer clic, no hacía falta una pantalla
        // cliente aparte solo para esto).
        <input readOnly value={link} className={`zx-control ${styles.link}`} />
      ) : (
        <p>No se encontró el token.</p>
      )}
      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
