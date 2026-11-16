import type { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { MarcoApp } from "@/components/marco/MarcoApp";
import { BotonCerrarSesionAccion } from "@/components/marco/BotonCerrarSesionAccion";
import { gruposSuperadmin } from "@/components/marco/menuSuperadmin";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { cerrarSesionSuperadminAction } from "../actions";

// Marco del vendedor (MarcoApp) para el panel superadmin. Solo presentación:
// la sesión, la cookie y el middleware no cambian, y cada página y server
// action sigue llamando requiereSesionSuperadmin() (un layout no se
// re-ejecuta en cada navegación, así que nunca es el candado). El login
// (/superadmin/iniciar-sesion) queda fuera de este grupo, sin marco.
export default async function SuperadminPanelLayout({ children }: { children: ReactNode }) {
  await requiereSesionSuperadmin();
  const clerkUser = await currentUser();
  const nombre = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || "Superadmin";

  return (
    <MarcoApp
      grupos={gruposSuperadmin()}
      usuario={{ nombre, imagenUrl: clerkUser?.imageUrl ?? null }}
      etiquetaPanel="Superadmin"
      mostrarMisDatos={false}
      cerrarSesion={<BotonCerrarSesionAccion accion={cerrarSesionSuperadminAction} />}
    >
      {children}
    </MarcoApp>
  );
}
