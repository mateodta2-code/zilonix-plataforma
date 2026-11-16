import type { ReactNode } from "react";
import { MarcoApp } from "@/components/marco/MarcoApp";
import { gruposDomiciliario } from "@/components/marco/menuBodega";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";

// Mismo marco; en celular la barra lateral se colapsa a íconos, igual
// que en el panel del vendedor.
export default async function DomiciliarioLayout({ children }: { children: ReactNode }) {
  const { usuario, clerkUser, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;

  return (
    <MarcoApp
      grupos={gruposDomiciliario()}
      usuario={{ nombre: usuario.nombre, imagenUrl: clerkUser?.imageUrl ?? null }}
      etiquetaPanel="Domiciliario"
      mostrarMisDatos={false}
    >
      {children}
    </MarcoApp>
  );
}
