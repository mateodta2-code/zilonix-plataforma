// Decisión de acceso a los paneles de bodega y domiciliario. Módulo puro:
// recibe las membresías ya leídas y devuelve si entra o por qué no.
import { ROLES_DEL_PANEL, type Panel, type RolBodega } from "./roles";

export type MembresiaBodega = {
  bodegaId: string;
  bodegaNombre: string;
  bodegaNit: string | null;
  bodegaEstado: "activa" | "suspendida";
  rol: RolBodega;
  activo: boolean;
};

export type MotivoSinAcceso = "en-espera" | "sin-membresia" | "desactivado" | "rol-incorrecto" | "suspendida";

export type DecisionAcceso = { ok: true; membresia: MembresiaBodega } | { ok: false; motivo: MotivoSinAcceso; membresia?: MembresiaBodega };

export function decidirAcceso(params: {
  panel: Panel;
  membresias: MembresiaBodega[];
  bodegaPreferidaId?: string;
  soloAdmin?: boolean;
  // Se registró como domiciliario (perfiles_domiciliario) pero ninguna bodega lo ha invitado.
  tienePerfilDomiciliario?: boolean;
}): DecisionAcceso {
  const decision = decidirPorMembresias(params);
  // Con perfil, «en espera» gana sobre sin-membresia y rol-incorrecto (un admin de
  // bodega con perfil también espera). Desactivado y suspendida siguen mandando.
  if (!decision.ok && params.panel === "domiciliario" && params.tienePerfilDomiciliario && (decision.motivo === "sin-membresia" || decision.motivo === "rol-incorrecto")) {
    return { ok: false, motivo: "en-espera" };
  }
  return decision;
}

function decidirPorMembresias(params: { panel: Panel; membresias: MembresiaBodega[]; bodegaPreferidaId?: string; soloAdmin?: boolean }): DecisionAcceso {
  const { panel, membresias, bodegaPreferidaId, soloAdmin } = params;
  if (membresias.length === 0) return { ok: false, motivo: "sin-membresia" };

  // Prefiere la bodega de la cookie y, entre las que sirven para este
  // panel, las activas — así quien está en dos bodegas no queda atrapado
  // en una desactivada.
  const sirve = (m: MembresiaBodega) => m.activo && ROLES_DEL_PANEL[panel].includes(m.rol);
  const elegida =
    membresias.find((m) => m.bodegaId === bodegaPreferidaId && sirve(m)) ??
    membresias.find(sirve) ??
    membresias.find((m) => m.bodegaId === bodegaPreferidaId) ??
    membresias[0];

  if (!elegida.activo) return { ok: false, motivo: "desactivado", membresia: elegida };
  if (!ROLES_DEL_PANEL[panel].includes(elegida.rol)) return { ok: false, motivo: "rol-incorrecto", membresia: elegida };
  if (elegida.bodegaEstado === "suspendida") return { ok: false, motivo: "suspendida", membresia: elegida };
  if (soloAdmin && elegida.rol !== "admin_bodega") return { ok: false, motivo: "rol-incorrecto", membresia: elegida };
  return { ok: true, membresia: elegida };
}

export const MENSAJE_SIN_ACCESO: Record<MotivoSinAcceso, string> = {
  "en-espera": "Aún no estás en ninguna bodega. Pídele a la bodega que te invite con tu correo.",
  "sin-membresia": "Esta cuenta no pertenece a ninguna bodega. Pide una invitación a quien administra tu bodega.",
  desactivado: "Tu acceso a esta bodega está desactivado. Escribe a quien la administra.",
  "rol-incorrecto": "Tu rol no tiene acceso a esta pantalla.",
  suspendida: "Esta bodega está suspendida. Escríbenos a soporte.",
};
