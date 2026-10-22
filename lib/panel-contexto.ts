import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Tarea de KPIs reales — antes, app/panel/layout.tsx y app/panel/page.tsx
// pedían exactamente lo mismo (usuario actual, empresas propias, empresa
// activa por cookie, membresía/rol) cada uno por su lado, a propósito
// (comentario viejo: "Next.js no comparte variables entre un layout y lo
// que tiene adentro"). Eso seguía siendo cierto, pero duplicaba 2
// consultas reales a Postgres en cada carga de /panel. cache() de React
// no comparte memoria ENTRE peticiones (cada visita arranca de cero) —
// solo deduplica llamadas con los mismos argumentos DENTRO del mismo
// render de una sola petición, que es justo el caso de layout+page
// pintándose juntos. Los redirects (/sign-in, /crear-empresa) viven acá
// adentro: layout y page necesitaban el mismo redirect en los mismos
// casos, así que no hace falta repetirlo en los dos.
export const obtenerContextoPanel = cache(async () => {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  if (propias.length === 0) redirect("/crear-empresa");

  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const activa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];
  const miMembresia = await obtenerMiMembresia(usuario.id, activa.id);
  const permisos = miMembresia?.permisos ?? [];
  const rolNombre = miMembresia?.rolNombre ?? "sin rol";

  const clerkUser = await currentUser();

  return { usuario, propias, activa, permisos, rolNombre, clerkUser };
});
