// Roles de una bodega 3PL y qué puede cada uno. Módulo puro (sin base ni
// Next): lo usan la pantalla de Permisos, el menú y las pruebas.
export const ROLES_BODEGA = ["admin_bodega", "operario", "domiciliario"] as const;
export type RolBodega = (typeof ROLES_BODEGA)[number];

// Los que un admin_bodega puede invitar (el admin_bodega lo invita el superadmin).
export const ROLES_INVITABLES_POR_ADMIN = ["operario", "domiciliario"] as const;

export const NOMBRE_ROL_BODEGA: Record<RolBodega, string> = {
  admin_bodega: "Administrador de bodega",
  operario: "Operario",
  domiciliario: "Domiciliario",
};

export function esRolBodega(valor: unknown): valor is RolBodega {
  return typeof valor === "string" && (ROLES_BODEGA as readonly string[]).includes(valor);
}

export function esRolInvitablePorAdmin(valor: unknown): valor is (typeof ROLES_INVITABLES_POR_ADMIN)[number] {
  return typeof valor === "string" && (ROLES_INVITABLES_POR_ADMIN as readonly string[]).includes(valor);
}

export type Panel = "bodega" | "domiciliario";

// Qué roles entran a cada panel.
export const ROLES_DEL_PANEL: Record<Panel, readonly RolBodega[]> = {
  bodega: ["admin_bodega", "operario"],
  domiciliario: ["domiciliario"],
};

// Matriz de solo lectura de la pantalla Permisos. Las entregas
// llegan después y se agregan acá.
export const PERMISOS_BODEGA: { capacidad: string; roles: readonly RolBodega[] }[] = [
  { capacidad: "Entrar al panel de la bodega", roles: ["admin_bodega", "operario"] },
  { capacidad: "Ver la lista de domiciliarios", roles: ["admin_bodega", "operario"] },
  { capacidad: "Registrar recepciones de mercancía", roles: ["admin_bodega", "operario"] },
  { capacidad: "Ver el inventario por empresa", roles: ["admin_bodega", "operario"] },
  { capacidad: "Ver los despachos y marcarlos como preparados", roles: ["admin_bodega", "operario"] },
  { capacidad: "Entrar al panel del domiciliario", roles: ["domiciliario"] },
  { capacidad: "Invitar operarios y domiciliarios", roles: ["admin_bodega"] },
  { capacidad: "Ver, desactivar y reactivar personas", roles: ["admin_bodega"] },
  { capacidad: "Cambiar el rol de una persona", roles: ["admin_bodega"] },
  { capacidad: "Editar el nombre y el NIT de la bodega", roles: ["admin_bodega"] },
];

export type EstadoInvitacionBodega = "valida" | "vencida" | "usada";

// Una invitación usada gana sobre vencida: ya cumplió su función.
export function estadoInvitacion(inv: { expiraTs: Date; aceptadaTs: Date | null }, ahora: Date): EstadoInvitacionBodega {
  if (inv.aceptadaTs) return "usada";
  if (inv.expiraTs.getTime() < ahora.getTime()) return "vencida";
  return "valida";
}
