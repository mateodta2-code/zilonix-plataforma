"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NOMBRE_COOKIE_SUPERADMIN, RUTA_COOKIE_SUPERADMIN } from "@/lib/superadmin-sesion";

// Cerrar sesión de superadmin: borra la cookie propia y cierra la
// sesión de Clerk. A propósito NO exige una sesión válida: cerrar
// sesión tiene que funcionar también con la cookie vencida.
export async function cerrarSesionSuperadminAction() {
  cookies().set(NOMBRE_COOKIE_SUPERADMIN, "", { path: RUTA_COOKIE_SUPERADMIN, maxAge: 0, httpOnly: true, sameSite: "strict" });
  try {
    const { sessionId } = await auth();
    if (sessionId) await (await clerkClient()).sessions.revokeSession(sessionId);
  } catch {
    // Si Clerk no responde, la cookie ya se borró: el panel queda cerrado igual.
  }
  redirect("/superadmin/iniciar-sesion");
}
