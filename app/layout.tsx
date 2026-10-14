import "./globals.css";
import { VERSION } from "@/lib/version";

export const metadata = {
  title: "Zilonix",
  description: "Plataforma multiempresa de Zilonix",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
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
  );
}
