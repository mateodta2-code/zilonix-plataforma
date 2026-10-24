import { SignUp } from "@clerk/nextjs";
import { aparienciaClerk } from "@/components/acceso/aparienciaClerk";
import styles from "../../page.module.css";

// Mismo criterio que app/sign-in/[[...sign-in]]/page.tsx: Clerk resuelve
// el formulario entero, acá solo se le aplica la identidad de marca.
export default function SignUpPage() {
  return (
    <main className={styles.portada}>
      <SignUp appearance={aparienciaClerk} />
    </main>
  );
}
