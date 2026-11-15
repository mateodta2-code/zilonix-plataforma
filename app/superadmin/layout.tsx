import type { ReactNode } from "react";
import { NavSuperadmin } from "@/components/superadmin/NavSuperadmin";

// Layout propio: sin el menú ni el selector de empresa de vendedores.
// No protege nada por sí solo — cada página y server action llama
// requiereSesionSuperadmin() (un layout no se re-ejecuta en cada
// navegación, así que nunca es el candado).
export default function SuperadminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavSuperadmin />
      {children}
    </>
  );
}
