import Link from "next/link";
import { urlPublicaBase } from "@/lib/url-publica";

// Tarea 1.7 — todavía no hay proveedor de correo decidido (D pendiente,
// fuera de esta tarea), así que el link se muestra en pantalla para
// que el Dueño lo copie y lo mande él mismo. El token nunca se guarda
// en ningún lado fuera de la base ni se expone por otra ruta.
export default function InvitacionListaPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  const link = token ? `${urlPublicaBase()}/invitacion/${token}` : null;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Invitación generada</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>Comparte este link con la persona — solo funciona una vez y vence en 7 días.</p>
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
        <input
          readOnly
          value={link}
          style={{ display: "block", width: "100%", padding: 10, marginTop: 16, fontFamily: "monospace", fontSize: 13 }}
        />
      ) : (
        <p>No se encontró el token.</p>
      )}
      <Link href="/panel" style={{ display: "inline-block", marginTop: 24, fontSize: 13 }}>
        Volver al panel
      </Link>
    </main>
  );
}
