import { Boton } from "@/components/marco/Boton";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";
import { evaluarAccesoSuperadmin } from "@/lib/superadmin";
import { cerrarSesionSuperadminAction } from "../../actions";

const MENSAJES: Record<string, string> = {
  cerrado: "El acceso de superadmin no está habilitado en este momento.",
  "no-autorizado": "Esta cuenta no tiene acceso al panel de superadmin.",
  "2fa": "Para entrar al panel de superadmin tienes que activar la verificación en dos pasos en tu cuenta. Actívala y vuelve a intentarlo.",
};

// Login APARTE del de vendedores: sin enlace a registro. Si llega con
// ?motivo=, NO monta <SignIn/>: Clerk reenviaría a una cuenta ya
// iniciada de vuelta a /superadmin y se armaría un ciclo.
export default async function IniciarSesionSuperadminPage({ searchParams }: { searchParams: { motivo?: string } }) {
  const motivo = searchParams.motivo;
  if (motivo) {
    return (
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "64px 24px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Acceso de superadmin</h1>
        <p style={{ fontSize: 14 }}>{MENSAJES[motivo] ?? MENSAJES["no-autorizado"]}</p>
        <form action={cerrarSesionSuperadminAction}>
          <Boton type="submit" variante="secundario">Cerrar sesión</Boton>
        </form>
      </main>
    );
  }

  // Con sesión de Clerk y chequeos al día pero sin cookie propia (primer
  // ingreso): se emite la cookie y se sigue a /superadmin.
  const acceso = await evaluarAccesoSuperadmin();
  if (acceso.ok) redirect("/superadmin/entrar");

  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "64px 24px" }}>
      <SignIn
        routing="path"
        path="/superadmin/iniciar-sesion"
        forceRedirectUrl="/superadmin"
        signUpUrl="/superadmin/iniciar-sesion"
        appearance={{ ...aparienciaClerk, elements: { ...(aparienciaClerk as { elements?: object }).elements, footer: { display: "none" } } }}
      />
    </main>
  );
}
