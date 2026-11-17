"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { LARGO_MAXIMO_RESPUESTA, LimiteMercadoLibreError, motivoErrorEscrituraMl, responderPreguntaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

export type ResultadoRespuesta = { ok: boolean; aviso: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PREGUNTA = /^\d{1,15}$/;

// Responder una pregunta (Refs #51). Escribe en Mercado Libre: exige
// ventas/modificar. El texto lo escribe la persona; nunca se arma a
// partir de lo que preguntó el comprador.
export async function responderPreguntaAction(entrada: { cuentaMlId: string; preguntaId: string; texto: string }): Promise<ResultadoRespuesta> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return { ok: false, aviso: "Tu rol no tiene permiso para responder preguntas." };
  }

  const texto = typeof entrada.texto === "string" ? entrada.texto.trim() : "";
  if (!UUID.test(entrada.cuentaMlId) || !ID_PREGUNTA.test(entrada.preguntaId)) {
    return { ok: false, aviso: "No se reconoce la pregunta. Actualiza la página." };
  }
  if (!texto) return { ok: false, aviso: "Escribe una respuesta antes de enviar." };
  if (texto.length > LARGO_MAXIMO_RESPUESTA) {
    return { ok: false, aviso: `La respuesta es muy larga (máximo ${LARGO_MAXIMO_RESPUESTA} caracteres).` };
  }

  // La cuenta tiene que ser de esta empresa y estar conectada.
  const [cuenta] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ id: cuentasMl.id, nickname: cuentasMl.nickname })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, entrada.cuentaMlId), eq(cuentasMl.empresaId, empresa.id), isNull(cuentasMl.desconectadaTs)))
  );
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };

  let respuesta;
  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
    respuesta = await responderPreguntaMl(entrada.preguntaId, texto, token);
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
  if (!respuesta.ok) {
    const motivo = motivoErrorEscrituraMl(respuesta.textoCrudo);
    console.warn(`[app/panel/preguntas] POST /answers respondió ${respuesta.status}`);
    if (respuesta.status === 401 || respuesta.status === 403) {
      return { ok: false, aviso: "Mercado Libre no dejó responder con esta cuenta. Puede que haya que reconectarla." };
    }
    return { ok: false, aviso: motivo ? `Mercado Libre no aceptó la respuesta: ${motivo}` : "Mercado Libre no aceptó la respuesta. Intenta de nuevo." };
  }

  // La respuesta ya quedó en Mercado Libre: si la auditoría falla, se
  // registra en el log pero no se le dice a la persona que no se envió.
  await dbComoEmpresa(empresa.id, (tx) =>
    registrarAuditoria(tx, {
      empresaId: empresa.id,
      usuarioId: usuario.id,
      actorTipo: "persona",
      accion: "responder_pregunta",
      entidad: "pregunta_ml",
      entidadId: entrada.preguntaId,
      detalle: `Respondió una pregunta en ${cuenta.nickname}.`,
    })
  ).catch((error: unknown) => {
    console.error(`[app/panel/preguntas] Auditoría de la respuesta falló: ${error instanceof Error ? error.name : "error"}`);
  });
  return { ok: true, aviso: "Respuesta enviada a Mercado Libre." };
}
