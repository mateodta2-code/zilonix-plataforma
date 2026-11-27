import type { ReactNode } from "react";
import { MarcoApp } from "@/components/marco/MarcoApp";
import { gruposBodega } from "@/components/marco/menuBodega";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";

// Mismo marco del panel del vendedor, con el menú de la bodega. No es el
// candado (un layout no se re-ejecuta en cada navegación): cada página y
// acción vuelve a llamar accesoBodega().
export default async function BodegaLayout({ children }: { children: ReactNode }) {
  const { usuario, clerkUser, decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} panel="bodega" />;

  return (
    <MarcoApp
      grupos={gruposBodega(decision.membresia.rol)}
      usuario={{ nombre: usuario.nombre, imagenUrl: clerkUser?.imageUrl ?? null }}
      etiquetaPanel="Bodega"
      mostrarMisDatos={false}
    >
      {children}
    </MarcoApp>
  );
}
