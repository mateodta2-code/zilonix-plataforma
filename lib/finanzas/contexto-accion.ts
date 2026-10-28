import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Issue #128 — usuario y empresa activa para las Server Actions de
// finanzas (mismo criterio que app/panel/sku/actions.ts). No revisa
// permisos: cada acción llama requierePermiso() con lo que necesita.
export async function usuarioYEmpresaActiva(): Promise<{ usuarioId: string; empresaId: string }> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

// El mensaje de un error esperado va en la URL (?error=) para que la
// página lo muestre. Son textos fijos de este código, nunca datos de la
// persona ni del archivo.
export function conMensaje(ruta: string, clave: "error" | "ok", mensaje: string): string {
  const separador = ruta.includes("?") ? "&" : "?";
  return `${ruta}${separador}${clave}=${encodeURIComponent(mensaje.slice(0, 200))}`;
}
