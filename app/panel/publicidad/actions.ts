"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { COLUMNAS_ORDEN } from "@/lib/publicidad/kpis";
import { textoErrorCorto } from "@/lib/publicidad/plan";

// Issue #254 — refresco manual, mínimo para probar la capa de datos
// antes de la pantalla de la fase 2. El permiso es consultar: esta
// fase no escribe campañas en Mercado Libre, solo vuelve a leerlas.
//
// El import del trabajo es dinámico. sincronizarPublicidad.ts carga
// db/trabajador-publicidad-context.ts, que revienta sin
// DATABASE_URL_PUBLICIDAD, y esta página se importa en el build.
export async function actualizarPublicidadAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  const cuentaCruda = formData.get("cuentaMlId");
  const cuentaMlId = typeof cuentaCruda === "string" ? cuentaCruda : "";
  const destino = (aviso: string) => {
    const q = new URLSearchParams();
    if (cuentaMlId) q.set("cuenta", cuentaMlId);
    q.set("aviso", aviso);
    const mes = formData.get("mes");
    if (typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) q.set("mes", mes);
    const orden = formData.get("orden");
    if (typeof orden === "string" && (COLUMNAS_ORDEN as readonly string[]).includes(orden)) q.set("orden", orden);
    const dir = formData.get("dir");
    if (dir === "asc" || dir === "desc") q.set("dir", dir);
    if (formData.get("pausadas") === "1") q.set("pausadas", "1");
    return `/panel/publicidad?${q.toString()}`;
  };

  try {
    await requierePermiso(usuario.id, empresa.id, "publicidad", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    redirect(destino("No tenés permiso para consultar Publicidad."));
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cuentaMlId)) {
    redirect(destino("Elegí una cuenta de Mercado Libre antes de actualizar."));
  }

  let aviso: string;
  try {
    const { refrescarPublicidadManual } = await import("@/lib/trabajos/sincronizarPublicidad");
    const resultado = await refrescarPublicidadManual(empresa.id, cuentaMlId, usuario.id);
    aviso = resultado.aviso;
  } catch (error) {
    const texto = textoErrorCorto(error);
    aviso = texto.includes("DATABASE_URL_PUBLICIDAD")
      ? "Falta configurar el cron de publicidad en este ambiente."
      : texto;
  }
  redirect(destino(aviso));
}
