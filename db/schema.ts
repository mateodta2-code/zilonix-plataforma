import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TokenCifrado } from "@/lib/cifrado";

// Tarea 1.2 del plan técnico — diseño aprobado por Mateo (14/10/2026)
// antes de construir. Diagrama en palabras simples en docs/modelo-datos.md.
//
// Todavía SIN seguridad por fila (RLS) ni usuario de base sin privilegios
// — eso es la tarea 1.3, a propósito la siguiente, no esta.

export const accionEnum = pgEnum("accion", ["consultar", "crear", "modificar", "anular", "autorizar"]);
// "todo" = ve/toca cualquier registro del módulo; "propio" = solo lo que
// esa persona creó. Idea real tomada de Effi (docs/investigacion/effi.md,
// sección D) — ahí solo aplica a "Consultar"; acá se generaliza para
// poder aplicarse a cualquier acción, no solo consultar.
export const alcanceEnum = pgEnum("alcance", ["todo", "propio"]);
// Separa siempre una acción de una persona real de una acción automática
// del sistema (evidencia real de Effi: le atribuía a una persona ventas
// que en realidad sincronizó la integración con Mercado Libre sola).
export const actorTipoEnum = pgEnum("actor_tipo", ["persona", "sistema"]);

export const empresas = pgTable("empresas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  // Una empresa por NIT/sociedad — decisión D2.
  nit: text("nit").notNull().unique(),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// No pertenecen a una sola empresa — un mismo usuario puede estar en
// varias (D2: "un login, varias empresas, cambio en 1 clic").
export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  // Vínculo con Clerk (D3) — el login en sí lo maneja Clerk, acá solo se
  // guarda la referencia. Queda vacío hasta la tarea 1.5.
  clerkUserId: text("clerk_user_id").unique(),
  // Tarea 1.11 — nadie nace superadmin. Se activa a mano (una fila a
  // la vez, decisión de Mateo, nunca de Claude Code) directo en la
  // base, igual que se eligió la contraseña de app_user en la tarea
  // 1.3 — no hay ninguna pantalla para "hacerse superadmin" solo.
  esSuperadmin: boolean("es_superadmin").notNull().default(false),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// Tarea 1.11 (decisión D8) — el permiso explícito y temporal que una
// empresa le da al superadmin para ver más que las cifras agregadas.
// Evidencia real (Olist Tiny, docs/investigacion/olist-tiny.md,
// sección D): el cliente mismo habilita un "usuário de suporte" que
// se apaga solo a los 15 días. A Olist le falta decir QUÉ ve ese
// acceso — por eso `alcance` es texto obligatorio, no un booleano
// "sí/no" genérico.
export const accesosTemporales = pgTable("accesos_temporales", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  concedidoPor: uuid("concedido_por").notNull().references(() => usuarios.id),
  alcance: text("alcance").notNull(),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  expiraTs: timestamp("expira_ts", { withTimezone: true }).notNull(),
  revocadoTs: timestamp("revocado_ts", { withTimezone: true }),
});

// empresaId vacío = plantilla de fábrica, compartida por todas las
// empresas; con valor = rol propio de esa empresa, armado a partir de
// una plantilla. Evidencia real (Effi): su matriz de permisos no trae
// plantillas seguras ni avisa de permisos peligrosos — un rol
// "Vendedora" terminó pudiendo crear usuarios y cambiar la numeración
// DIAN sin que nada lo advirtiera. esPlantilla existe para que acá un
// rol nuevo siempre nazca de una base segura, no de cero.
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "cascade" }),
  esPlantilla: boolean("es_plantilla").notNull().default(false),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// La conexión real: esta persona está en esta empresa, con este rol. Una
// persona solo puede tener un rol por empresa (no varios mezclados).
export const membresias = pgTable(
  "membresias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    rolId: uuid("rol_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unicaPorEmpresa: uniqueIndex("membresias_usuario_empresa_unica").on(t.usuarioId, t.empresaId),
  })
);

// Qué puede hacer cada rol, por módulo (ej. "ventas", "inventario",
// "facturacion", "tesoreria", "personas", "configuracion").
export const permisosRol = pgTable(
  "permisos_rol",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rolId: uuid("rol_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    modulo: text("modulo").notNull(),
    accion: accionEnum("accion").notNull(),
    alcance: alcanceEnum("alcance").notNull().default("todo"),
  },
  (t) => ({
    unicaPorAccion: uniqueIndex("permisos_rol_unica").on(t.rolId, t.modulo, t.accion),
  })
);

// Cuando un dueño invita a alguien por correo. Diferencial real frente a
// Effi (docs/investigacion/effi.md, sección D): Effi no tiene invitación
// por correo, el administrador le escribe la contraseña a mano al
// usuario — acá sí, con link de un solo uso que vence.
export const invitaciones = pgTable("invitaciones", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  rolId: uuid("rol_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  // Copia del nombre al momento de invitar (tarea 1.7) — a propósito NO
  // se leen empresas.nombre/roles.nombre en vivo en la pantalla de
  // "aceptar invitación": quien todavía no es miembro de esa empresa no
  // tiene (ni debe tener) forma de leer esas tablas por RLS. Evita
  // abrir una política nueva solo para mostrar un nombre; el token ya
  // es el único permiso real que hace falta para aceptar.
  empresaNombre: text("empresa_nombre").notNull(),
  rolNombre: text("rol_nombre").notNull(),
  token: text("token").notNull().unique(),
  invitadoPor: uuid("invitado_por").notNull().references(() => usuarios.id),
  expiraTs: timestamp("expira_ts", { withTimezone: true }).notNull(),
  aceptadaTs: timestamp("aceptada_ts", { withTimezone: true }),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// Quién hizo qué, cuándo, en qué empresa. empresaId/usuarioId quedan
// vacíos para acciones que no son de una empresa puntual (ej. login a
// la plataforma).
export const auditoria = pgTable("auditoria", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
  usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  actorTipo: actorTipoEnum("actor_tipo").notNull(),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(),
  detalle: text("detalle"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

// Tarea 2.3 — una cuenta de Mercado Libre conectada a una empresa.
// Tokens cifrados (lib/cifrado.ts, AES-256-GCM con versión de clave —
// regla de CLAUDE.md "tokens de marketplaces siempre cifrados"), nunca
// en texto plano ni en esta tabla ni en ningún log.
export const cuentasMl = pgTable(
  "cuentas_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaIdExterna: text("cuenta_id_externa").notNull(),
    nickname: text("nickname").notNull(),
    accessTokenCifrado: jsonb("access_token_cifrado").$type<TokenCifrado>().notNull(),
    refreshTokenCifrado: jsonb("refresh_token_cifrado").$type<TokenCifrado>().notNull(),
    tokenExpiraTs: timestamp("token_expira_ts", { withTimezone: true }).notNull(),
    // Candado contra renovaciones dobles — el refresh token de Mercado
    // Libre sirve una sola vez, dos procesos renovando a la vez
    // desconectan la cuenta (regla explícita de la tarea 2.3). Se fija
    // con un UPDATE atómico antes de llamar a Mercado Libre y se limpia
    // apenas termina, con o sin éxito; un candado de más de 30s se
    // considera abandonado (un proceso que se cayó a mitad de camino) y
    // se puede volver a tomar.
    renovandoTs: timestamp("renovando_ts", { withTimezone: true }),
    // Desconectar nunca borra la fila ni su historial (evidencia real de
    // UpSeller, tarea 2.3: al desconectar, sus pedidos dejaban de verse
    // sin aviso ni forma de recuperar el histórico) — queda marcada,
    // nunca eliminada.
    desconectadaTs: timestamp("desconectada_ts", { withTimezone: true }),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Una cuenta real de Mercado Libre no puede estar conectada a dos
    // empresas de Zilonix a la vez — evita ambigüedad de a quién le
    // pertenecen sus avisos y sus pedidos.
    cuentaUnica: uniqueIndex("cuentas_ml_cuenta_externa_unica").on(t.cuentaIdExterna),
  })
);

// Tarea 2.4 — adelanto parcial (pedido real de Mateo, 20/10: terminar
// de configurar la app de Mercado Libre de una vez, sin volver después
// a esa pantalla). Acá solo se guarda el aviso tal cual llega — el
// trabajador que lo PROCESA de verdad (traer el pedido real de la API,
// nunca confiar en los datos del aviso) es el resto de la tarea 2.4,
// todavía sin construir. `procesadoTs` queda vacío a propósito: es el
// marcador que el trabajador va a usar para saber qué le falta.
export const avisosMl = pgTable(
  "avisos_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaIdExterna: text("cuenta_id_externa").notNull(),
    topic: text("topic").notNull(),
    resource: text("resource").notNull(),
    enviadoTs: timestamp("enviado_ts", { withTimezone: true }).notNull(),
    recibidoTs: timestamp("recibido_ts", { withTimezone: true }).notNull().defaultNow(),
    procesadoTs: timestamp("procesado_ts", { withTimezone: true }),
  },
  (t) => ({
    // Mercado Libre reintenta si no le llega un 200 a tiempo — este
    // índice es el "sin duplicados" de la tarea 2.4 para la parte de
    // RECIBIR: el mismo aviso exacto (misma cuenta, tema, recurso y
    // momento de envío) nunca se guarda dos veces, sin importar
    // cuántas veces ML lo reintente.
    avisoUnico: uniqueIndex("avisos_ml_unico").on(t.cuentaIdExterna, t.topic, t.resource, t.enviadoTs),
  })
);

// Tarea 2.5 — importación inicial. Guarda solo lo mínimo real para
// cumplir el criterio de "listo" (ver el primer pedido en menos de 10
// minutos) — el detalle completo (línea de tiempo de 8 pasos, enlace
// con SKU propio) es de las tareas 2.6/2.7, no de esta.
export const pedidos = pgTable(
  "pedidos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    pedidoIdExterno: text("pedido_id_externo").notNull(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    moneda: text("moneda").notNull(),
    estado: text("estado").notNull(),
    importadoTs: timestamp("importado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pedidoUnico: uniqueIndex("pedidos_empresa_pedido_externo_unico").on(t.empresaId, t.pedidoIdExterno),
  })
);

export const publicaciones = pgTable(
  "publicaciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    publicacionIdExterno: text("publicacion_id_externo").notNull(),
    titulo: text("titulo").notNull(),
    precio: numeric("precio", { precision: 14, scale: 2 }).notNull(),
    stock: integer("stock").notNull(),
    // Enlace con SKU propio (tarea 2.6). Cambiar a qué SKU apunta una
    // publicación nunca debe poder romper un pedido ya hecho — por
    // eso un pedido (tarea 2.7) va a guardar su propio SKU en el
    // momento de la venta, nunca va a leerlo en vivo desde acá.
    skuId: uuid("sku_id").references(() => skus.id, { onDelete: "set null" }),
    importadoTs: timestamp("importado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    publicacionUnica: uniqueIndex("publicaciones_empresa_publicacion_externa_unica").on(t.empresaId, t.publicacionIdExterno),
  })
);

// Progreso de la importación inicial, uno por cuenta conectada — lo que
// lee la barra de progreso de /panel/conectar-ml.
export const importacionesMl = pgTable("importaciones_ml", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  pedidosEncontrados: integer("pedidos_encontrados").notNull().default(0),
  pedidosImportados: integer("pedidos_importados").notNull().default(0),
  publicacionesEncontradas: integer("publicaciones_encontradas").notNull().default(0),
  publicacionesImportadas: integer("publicaciones_importadas").notNull().default(0),
  error: text("error"),
  iniciadoTs: timestamp("iniciado_ts", { withTimezone: true }).notNull().defaultNow(),
  completadoTs: timestamp("completado_ts", { withTimezone: true }),
});

// Tarea 2.6 — SKU maestro. "Variantes" (ej. CAMISETA-AZUL-M,
// CAMISETA-AZUL-L) se resuelven con SKUs propios de cada una,
// agrupados solo por `nombreBase` para mostrarlos juntos en la lista —
// no hace falta una tabla de variantes aparte, cada variante YA es un
// SKU completo con su propio código, su propio stock real (el de la
// publicación enlazada) y su propio historial.
export const skus = pgTable(
  "skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    nombreBase: text("nombre_base"), // agrupa variantes del mismo producto en la lista; vacío si no aplica
    esKit: boolean("es_kit").notNull().default(false),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un código de SKU tiene que ser único DENTRO de una empresa —
    // nunca entre empresas distintas, cada una arma su propio catálogo.
    codigoUnico: uniqueIndex("skus_empresa_codigo_unico").on(t.empresaId, t.codigo),
  })
);

// Solo tiene filas cuando skus.es_kit = true — qué otros SKUs (y
// cuántos de cada uno) componen ese kit. Un kit nunca puede estar
// compuesto de sí mismo (chequeado en lib/ml/sku.ts, no acá — una
// restricción CHECK no puede comparar contra otra fila de la misma
// tabla).
export const kitComponentes = pgTable(
  "kit_componentes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    skuKitId: uuid("sku_kit_id").notNull().references(() => skus.id, { onDelete: "cascade" }),
    skuComponenteId: uuid("sku_componente_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
    cantidad: integer("cantidad").notNull(),
  },
  (t) => ({
    componenteUnico: uniqueIndex("kit_componentes_unico").on(t.skuKitId, t.skuComponenteId),
  })
);
