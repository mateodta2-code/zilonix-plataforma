import { ClerkProvider } from "@clerk/nextjs";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { VERSION } from "@/lib/version";

export const metadata = {
  title: "Zilonix",
  description: "Plataforma multiempresa de Zilonix",
};

// Tipografía del manual de marca: pide Creato Display, que no está en
// Google Fonts — para medios electrónicos el manual permite
// Montserrat. Un solo next/font/google con los 5 pesos que usa el
// marco (300/400/500/700/800: Light/Regular en texto, Medium/Bold
// para destacar, ExtraBold en títulos grandes) — nunca Cinzel, esa
// vive solo dentro del logo. next/font/google la autohospeda en el
// build (sin llamar a Google en cada visita) y la expone como
// variable CSS, que app/globals.css usa en
// --fuente-titulos/--fuente-texto — ninguna dependencia nueva.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--fuente-montserrat",
  display: "swap",
});

// Selector de tema (components/marco/SelectorTema.tsx) — sin este
// script, el tema real (guardado en localStorage) solo se aplicaría
// después de hidratar React, y entre el HTML del servidor (siempre
// oscuro por defecto) y ese momento se vería un parpadeo si alguien
// eligió "claro". Corre ANTES de pintar porque es un script normal en
// <head>, no un componente — por eso va a mano acá y no en un
// componente cliente. suppressHydrationWarning en <html> es porque
// este mismo script cambia el atributo data-tema antes de que React
// hidrate, así que el HTML que React esperaba (sin el atributo) y el
// real (con él) difieren a propósito.
const SCRIPT_TEMA = `
  try {
    var tema = localStorage.getItem("zilonix-tema");
    document.documentElement.setAttribute("data-tema", tema === "claro" ? "claro" : "oscuro");
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="es" suppressHydrationWarning className={montserrat.variable}>
        <head>
          <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        </head>
        <body>
          {children}
          {/* Pedido del plan técnico: la versión se ve en el pie de página de
              toda la app, sin excepción, para poder confirmar un deploy de
              un vistazo. */}
          <footer style={{ padding: "16px", textAlign: "center", fontSize: 12, opacity: 0.5 }}>
            Zilonix v{VERSION}
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
