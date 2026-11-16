"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cerrarSesionSuperadminAction } from "@/app/superadmin/actions";

// Menú propio del superadmin: solo "Empresas", "Moderar el foro" y
// cerrar sesión. Se oculta en la pantalla de login.
export function NavSuperadmin() {
  const ruta = usePathname();
  if (ruta?.startsWith("/superadmin/iniciar-sesion")) return null;
  return (
    <nav style={{ display: "flex", gap: 16, alignItems: "center", padding: "12px 24px", borderBottom: "1px solid currentColor", fontSize: 13 }}>
      <strong>Superadmin</strong>
      <Link href="/superadmin">Empresas</Link>
      <Link href="/superadmin/foro">Moderar el foro</Link>
      <form action={cerrarSesionSuperadminAction} style={{ marginLeft: "auto" }}>
        <button type="submit">Cerrar sesión de superadmin</button>
      </form>
    </nav>
  );
}
