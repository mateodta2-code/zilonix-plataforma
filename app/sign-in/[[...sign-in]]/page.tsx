import { SignIn } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";
import styles from "../../page.module.css";

// Componente ya hecho de Clerk (decisión D3) — registro, login, 2FA,
// verificación de correo, recuperación de acceso y límite de intentos
// vienen resueltos acá, no se arman a mano. Identidad de marca vía
// appearance (components/acceso/aparienciaClerk.ts) — mismas variables
// CSS de app/globals.css, nunca colores fijos ni un formulario propio.
export default function SignInPage() {
  return (
    <main className={styles.portada}>
      <SignIn appearance={aparienciaClerk} />
    </main>
  );
}
