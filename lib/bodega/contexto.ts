import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { decidirAcceso, type DecisionAcceso } from "./acceso";
import { listarMembresiasDeUsuario } from "./miembros";
import { tienePerfilDomiciliario } from "./perfil-domiciliario";
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
  // El perfil solo importa al panel del domiciliario y cuando todavía no hay
  // una membresía activa de domiciliario (ahí decide «en espera»).
  const sinMembresiaDomiciliario = !membresias.some((m) => m.rol === "domiciliario" && m.activo);
  const perfil = panel === "domiciliario" && sinMembresiaDomiciliario ? await tienePerfilDomiciliario(usuario.id) : false;
  return { usuario, membresias, clerkUser, perfil };
});

// ÚNICA puerta de los paneles /bodega y /domiciliario (páginas, layouts y
// server actions): un layout no es candado, cada página y acción la llama.
// Sin la membresía correcta devuelve ok:false (la pantalla pinta SinAcceso,
// nunca el panel del vendedor).
export async function accesoBodega(panel: Panel, opciones: { soloAdmin?: boolean } = {}) {
  const { usuario, membresias, clerkUser, perfil } = await cargar(panel);
  const decision: DecisionAcceso = decidirAcceso({
    panel,
    membresias,
    bodegaPreferidaId: cookies().get(COOKIE_BODEGA_ACTUAL)?.value,
    soloAdmin: opciones.soloAdmin,
    tienePerfilDomiciliario: perfil,
  });
  return { usuario, clerkUser, decision };
}
