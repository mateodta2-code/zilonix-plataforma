// Tarea 1.7/1.8 — datos puros de roles y permisos: sin ningún import de
// `db/`, a propósito. lib/roles.ts (las funciones que sí tocan la
// base) importa todo esto; scripts/generar-matriz-permisos.ts y sus
// pruebas importan SOLO este archivo, para poder generar la matriz de
// docs/matriz-permisos.md sin necesitar DATABASE_URL_APP ni Postgres
// — antes de este archivo, lib/roles.ts mezclaba las dos cosas y
// `npm run docs:permisos` reventaba pidiendo credenciales de base que
// no tenía nada que ver con lo que hace.

// Módulos de negocio. Todavía no existe ninguna pantalla real detrás
// de la mayoría (llegan en las Fases 2 y 3) salvo "finanzas", que
// sirve de demo para el criterio de "listo" de la tarea 1.7 ("el
// operador no ve Finanzas"). La lista es a propósito la misma que ya
// anticipaba el comentario de `auditoria` en db/schema.ts.
export const MODULOS = ["ventas", "inventario", "finanzas", "personas", "configuracion", "atencion"] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACCIONES = ["consultar", "crear", "modificar", "anular", "autorizar"] as const;
export type Accion = (typeof ACCIONES)[number];

export type Permiso = { modulo: Modulo; accion: Accion; alcance: "todo" | "propio" };

// Plantillas de fábrica — a propósito viven como constante en código,
// no como filas de `roles` con empresa_id NULL: no hay todavía ninguna
// pantalla que necesite EDITAR la plantilla en sí (eso sería una
// función de superadmin, fuera de alcance), solo copiarla al invitar
// por primera vez a alguien con ese rol. El esquema sigue soportando
// plantillas como filas reales el día que haga falta.
//
// Operador/Contador tienen permisos reales porque 1.7 los puede probar
// de verdad (ventas/inventario vs. finanzas). Proveedor y Domiciliario
// nacen sin ningún permiso: sus pantallas reales (portal del
// proveedor, app Flex) son las tareas 3.10 y 3.11 — inventar permisos
// para pantallas que no existen todavía sería adivinar, no construir.
export const NOMBRES_PLANTILLA = ["Operador", "Contador", "Proveedor", "Domiciliario"] as const;
export type NombrePlantilla = (typeof NOMBRES_PLANTILLA)[number];

export const PLANTILLAS: Record<NombrePlantilla, Permiso[]> = {
  Operador: [
    { modulo: "ventas", accion: "consultar", alcance: "todo" },
    { modulo: "ventas", accion: "crear", alcance: "todo" },
    { modulo: "ventas", accion: "modificar", alcance: "todo" },
    { modulo: "inventario", accion: "consultar", alcance: "todo" },
    { modulo: "inventario", accion: "modificar", alcance: "todo" },
    { modulo: "atencion", accion: "consultar", alcance: "todo" },
    { modulo: "atencion", accion: "modificar", alcance: "todo" },
  ],
  Contador: [
    { modulo: "finanzas", accion: "consultar", alcance: "todo" },
    { modulo: "finanzas", accion: "crear", alcance: "todo" },
    { modulo: "finanzas", accion: "modificar", alcance: "todo" },
    { modulo: "finanzas", accion: "autorizar", alcance: "todo" },
    { modulo: "ventas", accion: "consultar", alcance: "todo" },
    { modulo: "inventario", accion: "consultar", alcance: "todo" },
  ],
  Proveedor: [],
  Domiciliario: [],
};

// Los permisos del rol "Dueño" no vienen de una plantilla — nace con
// TODO sobre TODO, por definición (es quien creó la empresa). Lo usa
// lib/empresas.ts al crearla.
export function permisosDeDueno(): Permiso[] {
  return MODULOS.flatMap((modulo) => ACCIONES.map((accion) => ({ modulo, accion, alcance: "todo" as const })));
}

export function tienePermiso(permisos: { modulo: string; accion: string }[], modulo: Modulo, accion: Accion): boolean {
  return permisos.some((p) => p.modulo === modulo && p.accion === accion);
}

// Tarea 1.8 — evidencia real (Effi, docs/investigacion/effi.md, sección
// H): el rol "Vendedora" de la cuenta de Mateo podía crear perfiles de
// usuario y cambiar la numeración DIAN sin ningún aviso. Esta lista es
// lo que separa un permiso cualquiera de uno que, si se concede sin
// querer, puede cambiarle la facturación o los accesos a la empresa
// entera — esos piden confirmación aparte en /panel/roles (ver
// app/panel/roles/[rolId]/actions.ts).
export const PERMISOS_PELIGROSOS: { modulo: Modulo; accion: Accion }[] = [
  { modulo: "configuracion", accion: "autorizar" },
  { modulo: "configuracion", accion: "modificar" },
  { modulo: "finanzas", accion: "autorizar" },
  { modulo: "finanzas", accion: "anular" },
  { modulo: "personas", accion: "autorizar" },
];

export function esPeligroso(modulo: Modulo, accion: Accion): boolean {
  return PERMISOS_PELIGROSOS.some((p) => p.modulo === modulo && p.accion === accion);
}

// Codifica/decodifica el matriz propuesta para pasarla por la URL
// entre guardarPermisosAction (detecta el permiso peligroso) y la
// pantalla /panel/roles/[rolId]/confirmar — viven acá (no en
// actions.ts) porque un archivo "use server" solo puede exportar
// funciones async (toda función ahí se vuelve una Server Action), y
// estas son puro formateo de texto, sin tocar la base.
export function codificarPermisos(permisos: Permiso[]): string {
  return permisos.map((p) => `${p.modulo}.${p.accion}.${p.alcance}`).join(";");
}

export function decodificarPermisos(token: string): Permiso[] {
  return token
    .split(";")
    .filter(Boolean)
    .map((parte) => {
      const [modulo, accion, alcance] = parte.split(".");
      return { modulo: modulo as Modulo, accion: accion as Accion, alcance: alcance as "todo" | "propio" };
    });
}
