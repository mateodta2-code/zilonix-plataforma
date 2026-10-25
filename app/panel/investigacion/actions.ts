"use server";

import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { completarQueriesAnalizar } from "@/lib/ml/variantesBusqueda";
import { generarVariantesIA } from "@/lib/ml/variantesIA";

// Issue #225 — "Analizar estilo OS": Server Action (nunca un Route
// Handler — regla de CLAUDE.md, "Server Actions por defecto"; esta
// plataforma no tenía todavía un cliente de Anthropic, así que este
// es el primer lugar que lo usa) que le da a PanelDemanda.tsx (Client
// Component) las hasta 5 queries a escanear con la extensión: el
// término + 4 variantes de IA (lib/ml/variantesIA.ts), completadas con
// la heurística de reglas (lib/ml/variantesBusqueda.ts) si la IA
// falla, viene vacía o repite el término. Mismo permiso que
// page.tsx (consultar Investigación) — generar variantes de búsqueda
// es parte del mismo módulo, nunca una acción nueva de negocio.
async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

export async function generarQueriesAnalizarAction(termino: string): Promise<string[]> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) throw new Error("Sin sesión.");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");

  const variantesIA = await generarVariantesIA(termino); // nunca lanza — [] si la IA falla/viene vacía
  return completarQueriesAnalizar(termino, variantesIA);
}
