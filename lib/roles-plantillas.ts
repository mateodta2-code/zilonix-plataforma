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
// Issue #254 — "publicidad" entra con una sola acción de fábrica
// (consultar). Crear, modificar, anular y autorizar llegan en las fases
// 3 y 4, cuando haya propuestas y escritura en Mercado Libre. Dueño las
// tiene igual, porque permisosDeDueno() recorre MODULOS × ACCIONES.
// Rama feat-promociones — "promociones" entra con 3 acciones reales
// (consultar/aprobar/ejecutar, decisión de Mateo), no las 5 genéricas
// de siempre: buscar propuestas es "consultar", marcar Sí/No y
// confirmar el lote es "aprobar", y disparar el cambio real contra
// Mercado Libre es "ejecutar" — dos pasos humanos distintos a
// propósito, antes de que algo cambie de verdad en la cuenta de un
// vendedor. Solo Gerente y Operador reciben algo de fábrica esta
// vuelta (ver PLANTILLAS más abajo); Operaciones queda sin este
// módulo por ahora aunque el comentario viejo de arriba lo anticipaba
// — decisión explícita de Mateo para esta tarea, se puede ampliar
// después desde /panel/roles.
export const MODULOS = ["ventas", "inventario", "finanzas", "personas", "configuracion", "publicidad", "promociones"] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACCIONES = ["consultar", "crear", "modificar", "anular", "autorizar", "aprobar", "ejecutar"] as const;
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
//
// Issue #124 (Z-FIN-02) — Mateo confirmó 5 roles para Zilonix Seller:
// Gerente, Auxiliar (comodín), Tecnología, Contador (el de arriba, sin
// cambios) y Operaciones. Operaciones cubre también despachos y
// promociones, pero esos módulos todavía no existen en MODULOS — por
// ahora vive en ventas + inventario, y se le suman cuando lleguen sus
// pantallas. Operador/Proveedor/Domiciliario se quedan tal cual: hay
// empresas que ya los tienen copiados y cambiarlos acá no los tocaría
// igual (la plantilla solo se copia al crear el rol).
//
// Fase 1 sin aprobación de segundo actor (decisión de Sharel): el
// Gerente puede anular y autorizar en finanzas él solo. Esos dos, y
// "modificar" en configuracion (Gerente y Tecnología), están en
// PERMISOS_PELIGROSOS — al crear el rol desde la plantilla se copian
// directo; la confirmación aparte solo aplica al ajustarlos a mano
// desde /panel/roles.
export const NOMBRES_PLANTILLA = [
  "Gerente",
  "Auxiliar",
  "Tecnología",
  "Contador",
  "Operaciones",
  "Operador",
  "Proveedor",
  "Domiciliario",
] as const;
export type NombrePlantilla = (typeof NOMBRES_PLANTILLA)[number];

// Arma la lista de una vez para varios módulos con las mismas acciones
// — los roles nuevos repiten el mismo bloque de acciones en 2-3
// módulos, y escribirlo fila por fila es donde se cuela un olvido.
function permisosTodo(modulos: Modulo[], acciones: Accion[]): Permiso[] {
  return modulos.flatMap((modulo) => acciones.map((accion) => ({ modulo, accion, alcance: "todo" as const })));
}

// Quién consulta Publicidad en la plantilla (issue #254): Gerente (ve
// el negocio), Auxiliar (comodín operativo) y Operaciones (el comentario
// de arriba ya le asigna promociones cuando el módulo exista). Contador,
// Tecnología y Operador no la traen de fábrica — se les puede dar después
// desde /panel/roles. Solo "consultar": esta fase no escribe campañas.
export const PLANTILLAS: Record<NombrePlantilla, Permiso[]> = {
  Gerente: [
    ...permisosTodo(["ventas", "inventario", "finanzas"], ["consultar", "crear", "modificar", "anular", "autorizar"]),
    ...permisosTodo(["personas"], ["consultar", "crear", "modificar"]),
    ...permisosTodo(["configuracion"], ["consultar", "modificar"]),
    ...permisosTodo(["publicidad"], ["consultar"]),
    // Rama feat-promociones — Dueño y Gerente tienen todo (decisión de
    // Mateo); Gerente es quien de verdad usa el módulo día a día.
    ...permisosTodo(["promociones"], ["consultar", "aprobar", "ejecutar"]),
  ],
  Auxiliar: [
    ...permisosTodo(["ventas", "inventario", "finanzas"], ["consultar", "crear", "modificar"]),
    ...permisosTodo(["publicidad"], ["consultar"]),
  ],
  Tecnología: [
    ...permisosTodo(["configuracion"], ["consultar", "modificar"]),
    ...permisosTodo(["personas"], ["consultar", "crear", "modificar"]),
    ...permisosTodo(["ventas", "inventario"], ["consultar"]),
  ],
  Operaciones: [
    ...permisosTodo(["ventas"], ["consultar", "crear", "modificar"]),
    ...permisosTodo(["inventario"], ["consultar", "crear", "modificar", "anular"]),
    ...permisosTodo(["publicidad"], ["consultar"]),
  ],
  Operador: [
    { modulo: "ventas", accion: "consultar", alcance: "todo" },
    { modulo: "ventas", accion: "crear", alcance: "todo" },
    { modulo: "ventas", accion: "modificar", alcance: "todo" },
    { modulo: "inventario", accion: "consultar", alcance: "todo" },
    { modulo: "inventario", accion: "modificar", alcance: "todo" },
    // Rama feat-promociones — Operador solo consulta (decisión de
    // Mateo): puede ver candidatos/historial, nunca aprobar ni
    // ejecutar un cambio real en Mercado Libre.
    { modulo: "promociones", accion: "consultar", alcance: "todo" },
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

// Issue #124 (Z-FIN-02) — candado contra escalada al invitar: con
// "personas.crear" alguien podía invitar con CUALQUIER rol. Tecnología
// (sin finanzas) podía invitar a un Gerente, con finanzas.anular y
// finanzas.autorizar. Regla: solo se puede dar un rol si quien invita
// ya tiene cada uno de sus permisos (mismo módulo y acción; su alcance
// tiene que ser el mismo o "todo", que cubre a "propio").
type PermisoComparable = { modulo: string; accion: string; alcance: string };

export function permisosQueNoPuedeDar(propios: PermisoComparable[], aConceder: PermisoComparable[]): PermisoComparable[] {
  return aConceder.filter(
    (p) => !propios.some((q) => q.modulo === p.modulo && q.accion === p.accion && (q.alcance === p.alcance || q.alcance === "todo"))
  );
}

// `permisosDeRolesExistentes` (por nombre): si la empresa ya tiene un
// rol con ese nombre, la invitación lo reutiliza tal cual
// (asegurarRolDeEmpresa en lib/roles.ts) — y ese rol pudo ajustarse
// en /panel/roles con más permisos que la plantilla. En ese caso se
// compara contra los permisos reales del rol, no contra la plantilla.
export function plantillasQuePuedeDar(
  propios: PermisoComparable[],
  permisosDeRolesExistentes: Partial<Record<string, PermisoComparable[]>> = {}
): NombrePlantilla[] {
  return NOMBRES_PLANTILLA.filter(
    (nombre) => permisosQueNoPuedeDar(propios, permisosDeRolesExistentes[nombre] ?? PLANTILLAS[nombre]).length === 0
  );
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
  // Rama feat-promociones — "ejecutar" cambia precios/promociones DE
  // VERDAD en la cuenta de Mercado Libre de un cliente real; mismo
  // criterio que los de arriba (plata o accesos de la empresa
  // entera), nunca se concede sin que quien lo da sepa exactamente
  // qué está autorizando.
  { modulo: "promociones", accion: "ejecutar" },
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
