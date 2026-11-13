import Link from "next/link";
import type { Metadata } from "next";
import { TextoLegal } from "@/components/portada/TextoLegal";
import { TEXTO_PRIVACIDAD } from "@/lib/legal/privacidad-texto";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Política de privacidad · Zilonix Seller",
};

// Pública, sin sesión. Los campos {{DATO: …}} del texto se completan
// cuando se entreguen los datos reales de la empresa.
export default function PrivacidadPage() {
  const [titulo, ...resto] = TEXTO_PRIVACIDAD.split("\n");
  return (
    <main className={styles.pagina}>
      <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" className={styles.logo} width={220} height={80} />
      <h1 className={styles.titulo}>{titulo.replace(/^# /, "")}</h1>
      <TextoLegal markdown={resto.join("\n")} />
      <Link href="/" className={styles.volver}>
        Volver al inicio
      </Link>
    </main>
  );
}
