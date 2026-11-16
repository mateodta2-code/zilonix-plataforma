import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { decidirAcceso, type DecisionAcceso } from "./acceso";
import { listarMembresiasDeUsuario } from "./miembros";
import type { Panel } from "./roles";

export const COOKIE_BODEGA_ACTUAL = "bodega_actual";
export const RUTA_LOGIN: Record<Panel, string> = { bodega: "/bodega/iniciar-sesion", domiciliario: "/domiciliario/iniciar-sesion" };

// Un solo cálculo por petición (layout y página se pintan juntos). Sin
// sesión redirige al login PROPIO del panel — nunca a /sign-in ni a /panel.
const cargar = cache(async (panel: Panel) => {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect(RUTA_LOGIN[panel]);
  const membresias = await listarMembresiasDeUsuario(usuario.id);
  const clerkUser = await currentUser();
  return { usuario, membresias, clerkUser };
});

// ÚNICA puerta de los paneles /bodega y /domiciliario (páginas, layouts y
// server actions): un layout no es candado, cada página y acción la llama.
// Sin la membresía correcta devuelve ok:false (la pantalla pinta SinAcceso,
// nunca el panel del vendedor).
export async function accesoBodega(panel: Panel, opciones: { soloAdmin?: boolean } = {}) {
  const { usuario, membresias, clerkUser } = await cargar(panel);
  const decision: DecisionAcceso = decidirAcceso({
    panel,
    membresias,
    bodegaPreferidaId: cookies().get(COOKIE_BODEGA_ACTUAL)?.value,
    soloAdmin: opciones.soloAdmin,
  });
  return { usuario, clerkUser, decision };
}
