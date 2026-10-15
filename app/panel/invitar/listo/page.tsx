import { headers } from "next/headers";
import Link from "next/link";

// Tarea 1.7 — todavía no hay proveedor de correo decidido (D pendiente,
// fuera de esta tarea), así que el link se muestra en pantalla para
// que el Dueño lo copie y lo mande él mismo. El token nunca se guarda
// en ningún lado fuera de la base ni se expone por otra ruta.
export default function InvitacionListaPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  const encabezados = headers();
  const host = encabezados.get("host");
  const proto = encabezados.get("x-forwarded-proto") ?? "https";
  const link = token ? `${proto}://${host}/invitacion/${token}` : null;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Invitación generada</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>Comparte este link con la persona — solo funciona una vez y vence en 7 días.</p>
      {link ? (
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
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
