"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { AVISO_REFRESCO_FALLIDO, textoErrorCorto } from "@/lib/publicidad/plan";

// Issue #254 — refresco manual, mínimo para probar la capa de datos
// antes de la pantalla de la fase 2. El permiso es consultar: esta
// fase no escribe campañas en Mercado Libre, solo vuelve a leerlas.
//
// El import del trabajo es dinámico. sincronizarPublicidad.ts carga
// db/trabajador-publicidad-context.ts, que revienta sin
// DATABASE_URL_PUBLICIDAD, y esta página se importa en el build.
//
// Devuelve el aviso en vez de redirigir con ?aviso= (14-nov): en
// staging el aviso no aparecía al terminar. FormActualizar lo muestra
// él mismo y refresca los datos, sin depender de que la redirección
// llegue al navegador después de varios minutos.
export type ResultadoActualizar = { ok: boolean; aviso: string };

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function actualizarPublicidadAction(formData: FormData): Promise<ResultadoActualizar> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "publicidad", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return { ok: false, aviso: "No tenés permiso para consultar Publicidad." };
  }

  const cuentaCruda = formData.get("cuentaMlId");
  const cuentaMlId = typeof cuentaCruda === "string" ? cuentaCruda : "";
  if (!PATRON_UUID.test(cuentaMlId)) {
    return { ok: false, aviso: "Elegí una cuenta de Mercado Libre antes de actualizar." };
  }

  try {
    const { refrescarPublicidadManual } = await import("@/lib/trabajos/sincronizarPublicidad");
    return await refrescarPublicidadManual(empresa.id, cuentaMlId, usuario.id);
  } catch (error) {
    // El texto crudo solo al log. A la persona, un aviso fijo.
    const texto = textoErrorCorto(error);
    console.error("[app/panel/publicidad] Actualizar ahora falló:", texto);
    return {
      ok: false,
      aviso: texto.includes("DATABASE_URL_PUBLICIDAD")
        ? "Falta configurar el cron de publicidad en este ambiente."
        : AVISO_REFRESCO_FALLIDO,
    };
  }
}
