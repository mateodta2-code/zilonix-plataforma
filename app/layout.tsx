import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import "./globals.css";
import { VERSION } from "@/lib/version";

export const metadata = {
  title: "Zilonix",
  description: "Plataforma multiempresa de Zilonix",
};

// Tipografía del manual de marca: pide Creato Display, que no está en
// Google Fonts — para medios electrónicos el manual permite
// Montserrat. next/font/google la descarga en el build y en CI (el
// de #102) el loader revienta: TypeError: Cannot read properties of
// null (reading '1'). Los woff2 latin de los pesos que el CSS usa de
// verdad (400/500/600/700/800 — hay `font-weight: 600` y no hay 300)
// están en app/fonts/montserrat/, tomados de @fontsource/montserrat
// (subset del fuente oficial, licencia OFL al lado) sin agregar la
// dependencia. next/font/local los sirve en el build y los expone en
// la misma variable que app/globals.css ya usa (--fuente-montserrat).
// Nunca Cinzel: esa vive solo dentro del logo.
const montserrat = localFont({
  src: [
    { path: "./fonts/montserrat/montserrat-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
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
