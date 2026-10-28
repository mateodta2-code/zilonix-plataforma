import { sql } from "drizzle-orm";
import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TokenCifrado } from "@/lib/cifrado";
import type {
  DatosPorCuenta,
  DimensionesProducto,
  ImagenProducto,
  ResultadoPublicacionCuenta,
  VariantesProducto,
} from "@/lib/ml/publicar-tipos";

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
// Tarea 2.10 — valores reales confirmados contra el código ya en
// producción del Zilonix OS actual (lib/mercadolibre-despachos.js):
// self_service = Flex, xd_drop_off = Places (agencia), cross_docking =
// Colecta, fulfillment = Full (nunca imprime guía física — ML la
// rechaza con "INVALID_SHIPMENT_FF_PUBLIC", no aplica despacho).
export const logisticTypeEnum = pgEnum("logistic_type", ["self_service", "xd_drop_off", "cross_docking", "fulfillment", "otro"]);
// Tarea 2.11 — estado de un intento de publicación. "con_errores" cubre
// tanto "ninguna cuenta funcionó" como "algunas sí, otras no" (mismo
// criterio ya usado en el sistema actual — ver lib/ml/publicar.ts).
export const estadoProductoMlEnum = pgEnum("estado_producto_ml", ["borrador", "publicando", "publicado", "con_errores"]);
// Tarea 2.7 — los 8 pasos de trazabilidad del plan maestro
// (docs/plan-maestro.md, sección 5, zilonix-os-web): "venta → pago →
// factura → empaque → despacho → entrega → novedades → dinero
// conciliado". Orden fijo, siempre estos 8 — nunca se agregan pasos
// sueltos por fuera de esta lista.
export const pasoPedidoEnum = pgEnum("paso_pedido", [
  "venta",
  "pago",
  "factura",
  "empaque",
  "despacho",
  "entrega",
  "novedades",
  "dinero_conciliado",
]);
// Issue #175 — qué se sigue: un producto puntual (publicación o
// catálogo) o una tienda/vendedor completo.
export const seguimientoTipoEnum = pgEnum("seguimiento_tipo", ["producto", "tienda"]);
// Solo tiene sentido cuando seguimiento_tipo = "producto": un link de
// Mercado Libre puede apuntar a una PUBLICACIÓN real (GET /items/{id})
// o a un PRODUCTO de catálogo (GET /products/{id}) — endpoints
// distintos, nunca intercambiables (mismo hallazgo real que
// obtenerItemMl ya documenta en lib/ml/cliente.ts). "seller" es el
// único valor real cuando el tipo es "tienda".
export const seguimientoRecursoMlEnum = pgEnum("seguimiento_recurso_ml", ["item", "product", "seller"]);
// Issue #175 — comparación contra la foto del día anterior. Cada valor
// es un hecho objetivo observado, nunca una opinión ("posible venta" se
// explica en el mensaje que arma lib/seguimiento/alertas.ts a partir de
// "inventario_bajo" + las unidades, no es un tipo de alerta aparte).
// "vendio_unidades" SÍ es aparte de "inventario_bajo": usa sold_quantity,
// el contador real de Mercado Libre, nunca una estimación por inventario.
export const alertaSeguimientoTipoEnum = pgEnum("alerta_seguimiento_tipo", [
  "precio_bajo",
  "precio_subio",
  "entro_catalogo",
  "salio_catalogo",
  "gano_boton_compra",
  "perdio_boton_compra",
  "inventario_bajo",
  "vendio_unidades",
  "pausada",
  "finalizada",
  "publicacion_nueva",
  "publicacion_eliminada",
]);

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

// Tarea 2.7 — un pedido puede tener como máximo un evento por paso (no
// tiene sentido "venta" dos veces para el mismo pedido). actorTipo
// "sistema" para todo lo que confirma la API de Mercado Libire sola —
// nunca se le atribuye a una persona lo que hizo la integración (mismo
// criterio ya probado en la tarea 1.9).
export const pedidoEventos = pgTable(
  "pedido_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id, { onDelete: "cascade" }),
    paso: pasoPedidoEnum("paso").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    actorTipo: actorTipoEnum("actor_tipo").notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    detalle: text("detalle"),
  },
  (t) => ({
    pasoUnico: uniqueIndex("pedido_eventos_pedido_paso_unico").on(t.pedidoId, t.paso),
  })
);

// Tarea 2.10 — Despachos. `imprimible` se calcula al sincronizar (ver
// lib/ml/despachos.ts) con la misma regla real ya confirmada en el
// sistema actual: solo en pending/handling/ready_to_ship Mercado Libre
// deja imprimir/reimprimir — una vez el transportador recoge el
// paquete, el bloqueo es real y permanente de Mercado Libre, no algo
// que se pueda evitar por API.
export const despachosMl = pgTable(
  "despachos_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    shipmentIdExterno: text("shipment_id_externo").notNull(),
    logisticType: logisticTypeEnum("logistic_type"),
    status: text("status"),
    substatus: text("substatus"),
    imprimible: boolean("imprimible").notNull().default(false),
    etiquetaImpresaTs: timestamp("etiqueta_impresa_ts", { withTimezone: true }),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shipmentUnico: uniqueIndex("despachos_ml_empresa_shipment_unico").on(t.empresaId, t.shipmentIdExterno),
  })
);

// Tarea 2.11 ("Publicar producto y clip") — el formulario SIEMPRE
// persiste antes de tocar Mercado Libre (mismo diseño confirmado en el
// sistema actual: el publicador real nunca recibe un objeto en
// memoria, siempre relee esta fila) — así un reintento o un diagnóstico
// posterior tiene de dónde partir. `porCuenta`/`cuentasSeleccionadas`
// usan el `id` interno de cuentas_ml como clave (no un alias de texto
// como en el sistema actual): es el identificador real y único que ya
// tenemos en la plataforma nueva, sin inventar uno nuevo.
export const productosMl = pgTable("productos_ml", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  // Nombre interno — se llena DESPUÉS de publicar con el título de la
  // primera cuenta (mismo criterio real del sistema actual), nunca
  // antes. Antes de eso queda vacío.
  titulo: text("titulo"),
  condicion: text("condicion").notNull().default("new"),
  precio: numeric("precio", { precision: 14, scale: 2 }).notNull(),
  stock: integer("stock").notNull().default(1),
  envioGratis: boolean("envio_gratis").notNull().default(false),
  sku: text("sku"),
  dimensiones: jsonb("dimensiones").$type<DimensionesProducto>().notNull().default({}),
  imagenes: jsonb("imagenes").$type<ImagenProducto[]>().notNull().default([]),
  // { [ATTR_ID]: "valor texto" } — lo que la persona llenó a mano,
  // obligatorio o no (ver lib/ml/publicar-reglas.ts).
  atributosExtra: jsonb("atributos_extra").$type<Record<string, string>>().notNull().default({}),
  // Clave compuesta "${siteId}::${titulo}" → categoryId — override manual
  // cuando la detección automática se equivocó, nunca se vuelve a
  // adivinar por título una vez elegida a mano.
  categoriasOverride: jsonb("categorias_override").$type<Record<string, string>>().notNull().default({}),
  variantes: jsonb("variantes").$type<VariantesProducto | null>(),
  // { [cuentaMlId]: { titulo, descripcion, portadaUrl, portadasPorVariante } }
  porCuenta: jsonb("por_cuenta").$type<Record<string, DatosPorCuenta>>().notNull().default({}),
  cuentasSeleccionadas: jsonb("cuentas_seleccionadas").$type<string[]>().notNull().default([]),
  modoPrueba: boolean("modo_prueba").notNull().default(false),
  estado: estadoProductoMlEnum("estado").notNull().default("borrador"),
  resultado: jsonb("resultado").$type<ResultadoPublicacionCuenta[] | null>(),
  publicadoTs: timestamp("publicado_ts", { withTimezone: true }),
  creadoPorUsuarioId: uuid("creado_por_usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// Issue #175 — qué se sigue: un producto (publicación o catálogo) o
// una tienda/vendedor, por empresa. "Competidor" es solo una marca
// (es_competidor) sobre el mismo seguimiento, no una tabla aparte — el
// tope real de 5 competidores por empresa se valida en el servidor
// (lib/seguimiento/seguimientos.ts), nunca acá con una constraint: un
// trigger de conteo agregaría complejidad en SQL a mano por algo que
// la aplicación ya puede chequear antes de insertar, dentro de la
// misma transacción de dbComoEmpresa.
//
// Nunca se borra de verdad (mismo criterio que cuentas_ml.desconectada_ts):
// quitar un seguimiento marca eliminado_ts, para no perder su
// historial de fotos/alertas si se vuelve a agregar después — agregar
// el MISMO ml_id_externo que ya estaba eliminado revive esa fila en
// vez de insertar una nueva (ver agregarSeguimiento()).
export const seguimientosMl = pgTable(
  "seguimientos_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: seguimientoTipoEnum("tipo").notNull(),
    recursoMl: seguimientoRecursoMlEnum("recurso_ml").notNull(),
    // item/product id (formato MCOxxxx) o seller id (solo dígitos) —
    // el mismo valor que ya usan los patrones reales de lib/ml/cliente.ts.
    mlIdExterno: text("ml_id_externo").notNull(),
    // Título del producto o nickname de la tienda, al momento de
    // agregar el seguimiento — igual que invitaciones.empresa_nombre/
    // rol_nombre: una copia liviana para no tener que volver a pedirle
    // el nombre a Mercado Libre solo para pintar la lista.
    nombre: text("nombre").notNull(),
    linkOriginal: text("link_original").notNull(),
    esCompetidor: boolean("es_competidor").notNull().default(false),
    creadoPor: uuid("creado_por").notNull().references(() => usuarios.id),
    eliminadoTs: timestamp("eliminado_ts", { withTimezone: true }),
    // Lo fija el trabajador diario (lib/trabajos/revisionDiariaSeguimiento.ts)
    // después de guardar la foto del día — sirve para el panel ("hace
    // cuánto se revisó por última vez") y para que una corrida manual
    // no reprocese dos veces el mismo día.
    ultimaRevisionTs: timestamp("ultima_revision_ts", { withTimezone: true }),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Issue #175 — no tiene sentido seguir el mismo producto/tienda dos
    // veces en la misma empresa. Revivir uno eliminado reusa esta misma
    // fila (ver arriba), así que el índice solo mira el valor, nunca si
    // está eliminado o no.
    seguimientoUnico: uniqueIndex("seguimientos_ml_empresa_recurso_unico").on(t.empresaId, t.mlIdExterno),
  })
);

// Issue #175 — una foto por seguimiento por día (índice único de
// abajo). Todo lo numérico/booleano queda NULL cuando Mercado Libre no
// lo deja ver para ese recurso puntual (regla explícita del issue:
// "lo que ML no deje ver queda como no disponible, nunca inventado") —
// nunca un 0/false adivinado en su lugar.
export const seguimientoFotos = pgTable(
  "seguimiento_fotos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    seguimientoId: uuid("seguimiento_id").notNull().references(() => seguimientosMl.id, { onDelete: "cascade" }),
    // DATE, no timestamp: la revisión diaria es una vez al día — "misma
    // fecha" es la clave real de "misma foto", no un instante exacto.
    fecha: timestamp("fecha", { withTimezone: false, mode: "date" }).notNull(),
    precio: numeric("precio", { precision: 14, scale: 2 }),
    // El campo original_price real de Mercado Libre (precio de
    // referencia tachado cuando hay descuento) — nunca una resta contra
    // la foto de ayer, que es una cuenta distinta y ya la hace la
    // comparación de alertas (lib/seguimiento/alertas.ts) con las dos
    // fotos completas.
    precioAnterior: numeric("precio_anterior", { precision: 14, scale: 2 }),
    inventarioDisponible: integer("inventario_disponible"),
    // Issue #175 — "el inventario de publicaciones ajenas puede venir
    // aproximado y así se aclara en pantalla": lo fija el lector
    // cuando el número que devuelve Mercado Libre para un recurso
    // AJENO no es el disponible real exacto (confirmado en vivo con
    // el diagnóstico de /panel/investigacion/diagnostico).
    inventarioAproximado: boolean("inventario_aproximado").notNull().default(false),
    // sold_quantity real de Mercado Libre — acumulado histórico de la
    // publicación, nunca "vendido desde ayer" (esa resta la hace la
    // comparación de alertas, lib/seguimiento/alertas.ts, con las dos
    // fotos completas, y solo si las dos trajeron un número real).
    vendidos: integer("vendidos"),
    estado: text("estado"), // status real de ML (active/paused/closed/...), null = no disponible
    enCatalogo: boolean("en_catalogo"),
    ganaBotonCompra: boolean("gana_boton_compra"),
    esFull: boolean("es_full"),
    esEnvioGratis: boolean("es_envio_gratis"),
    // Solo para tipo = "tienda". null para tipo = "producto". `visibles`
    // es el snapshot liviano de publicaciones que la comparación de
    // alertas usa para detectar nuevas/eliminadas entre un día y el
    // siguiente. `total` (issue #251, punto 5) — el total REAL que
    // Mercado Libre muestra arriba del listado ("752 resultados"),
    // leído de la página por la extensión (la API da 403 real al
    // listar publicaciones de una tienda ajena) — `null` mientras no
    // haya lectura de página todavía. `fuente` (corrección de Pablo) —
    // "api" o "pagina": `visibles` de "pagina" es solo una página
    // (~48) del listado real, nunca el total completo que sí trae una
    // foto "api" — lib/seguimiento/alertas.ts la usa para no comparar
    // nuevas/eliminadas entre dos snapshots que nunca fueron
    // completos. Las filas viejas (antes de este campo) se tratan como
    // "api" vía normalizarPublicaciones (lib/seguimiento/alertas.ts),
    // nunca se asume "pagina" sin confirmarlo. Sin columna aparte a
    // propósito (sin migración): todo va dentro del mismo JSON que ya
    // existía.
    // Issue #252 (smoke de staging) — para tipo = "producto", esta
    // MISMA columna (nunca una nueva, sin migración) también guarda
    // `{ vendidosAproximado }` — el piso "+N vendidos" de la ficha,
    // cuando Mercado Libre no deja ver el número exacto. Es la ÚNICA
    // columna que tipo="producto" nunca llena por otro motivo, así
    // que reusarla acá no choca con nada — `vendidosAproximado` nunca
    // aparece junto con `visibles` (son dos formas mutuamente
    // excluyentes del mismo campo, una por tipo de seguimiento).
    // Nunca se compara en alertas (lib/seguimiento/alertas.ts,
    // compararFotos, solo mira `publicaciones` para tipo="tienda") —
    // ver `obtenerVendidosAproximado`/`obtenerPrecioAproximado` para
    // cómo se lee del lado de la UI sin confundirla con el total de
    // una tienda. `precioAproximado` (también #252) — mismo criterio,
    // el precio que lee la extensión como respaldo cuando ML nunca
    // confirma uno real por la API. Los dos campos son independientes
    // (pueden venir juntos o separados) — el `set` del upsert
    // (lib/seguimiento/seguimientos.ts) los MEZCLA con `||` de
    // Postgres, nunca los reemplaza como objeto completo.
    // Issue #251 ("Seguimiento muestra aproximados como Selltrix") —
    // `fechaCreacion` (date_created real) suma al mismo objeto de
    // tipo="producto" — SOLO la escribe el cron (lib/trabajos/
    // revisionDiariaSeguimiento.ts, con el mismo merge `||`, nunca
    // reemplaza el objeto completo), nunca la extensión: a diferencia
    // de vendidosAproximado/precioAproximado (respaldos de la página),
    // esta es un dato que la API sí confirma. SOLO para recurso_ml
    // "item" — el date_created de LA publicación puntual que se sigue.
    //
    // Issue #262 (revisión de Pablo, punto bloqueante) — `fechaCreacionCatalogo`
    // es un campo APARTE, nunca el mismo `fechaCreacion`: para
    // recurso_ml "product" (catálogo, /p/MCO...), `fechaCreacion`
    // (arriba) hubiera salido de la oferta GANADORA de ese catálogo —
    // el date_created de un ITEM puntual de un vendedor cualquiera,
    // nunca el del catálogo en sí (lib/seguimiento/lector.ts ya NO lo
    // guarda ahí, a propósito). `fechaCreacionCatalogo` sale de
    // obtenerProducto (lib/ml/cliente.ts, GET /products/{id} — la
    // misma llamada que ya hacía resolverNombre para el nombre, sin
    // ninguna llamada nueva), la única fuente real del date_created
    // del catálogo mismo.
    publicaciones: jsonb("publicaciones").$type<
      | { total: number | null; visibles: { itemId: string; titulo: string | null; precio: number | null }[]; fuente: "api" | "pagina" }
      | { vendidosAproximado?: number; precioAproximado?: number; fechaCreacion?: string; fechaCreacionCatalogo?: string }
    >(),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fotoUnicaPorDia: uniqueIndex("seguimiento_fotos_seguimiento_fecha_unica").on(t.seguimientoId, t.fecha),
  })
);

// Issue #175 — una alerta siempre nace de comparar la foto de hoy
// contra la de ayer (fotoId = la de HOY, la que disparó la alerta;
// la de ayer se busca por fecha, nunca se duplica acá). `detalle`
// guarda los números crudos de la comparación (ej. precioAnterior/
// precioNuevo/porcentaje, o unidadesVendidas) — el texto en español
// que lee una persona se arma en lib/seguimiento/alertas.ts a partir
// de tipo+detalle, nunca se guarda ya armado (así una mejora de
// redacción futura aplica también a las alertas viejas).
export const seguimientoAlertas = pgTable("seguimiento_alertas", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  seguimientoId: uuid("seguimiento_id").notNull().references(() => seguimientosMl.id, { onDelete: "cascade" }),
  fotoId: uuid("foto_id").notNull().references(() => seguimientoFotos.id, { onDelete: "cascade" }),
  tipo: alertaSeguimientoTipoEnum("tipo").notNull(),
  detalle: jsonb("detalle").$type<Record<string, unknown>>().notNull(),
  // "Marcar como leída" (pantalla /panel/investigacion/seguimiento) —
  // nunca se borra una alerta leída, solo se marca, para que el
  // historial de alertas siga completo.
  leidaTs: timestamp("leida_ts", { withTimezone: true }),
  creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
});

// Issue #254 — Product Ads. La API no documenta la zona del corte de
// `date_from`/`date_to` (docs/publicidad/api-research.md §8.6). `fecha`
// guarda el `date` (YYYY-MM-DD) que devuelve Mercado Libre, sin
// convertirlo a otra zona: moverlo podría juntar dos días o partir uno.
export const publicidadEstadoAccesoEnum = pgEnum("publicidad_estado_acceso", ["ok", "sin_product_ads", "sin_permiso_app"]);
export const publicidadNivelMetricaEnum = pgEnum("publicidad_nivel_metrica", ["cuenta", "campana", "ad_group", "anuncio"]);
export const publicidadOrigenSyncEnum = pgEnum("publicidad_origen_sync", ["programada", "manual"]);
export const publicidadEstadoSyncEnum = pgEnum("publicidad_estado_sync", ["en_curso", "ok", "parcial", "error"]);

export const publicidadAnunciantes = pgTable("publicidad_anunciantes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  advertiserId: text("advertiser_id"),
  siteId: text("site_id"),
  nombre: text("nombre"),
  estadoAcceso: publicidadEstadoAccesoEnum("estado_acceso").notNull(),
  verificadoTs: timestamp("verificado_ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // empresa_id va en la clave: transferir la cuenta (la fila de
  // cuentas_ml cambia de empresa, el id no) no puede chocar con el
  // historial que se queda en la empresa anterior. Esas filas siguen
  // visibles solo para esa empresa, por RLS, y la nueva empieza de cero.
  cuentaUnica: uniqueIndex("publicidad_anunciantes_cuenta_unica").on(t.empresaId, t.cuentaMlId),
}));

export const publicidadCampanas = pgTable("publicidad_campanas", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  campanaIdMl: text("campana_id_ml").notNull(),
  nombre: text("nombre"),
  estado: text("estado"),
  estrategia: text("estrategia"),
  presupuesto: numeric("presupuesto", { precision: 14, scale: 2 }),
  presupuestoDiario: numeric("presupuesto_diario", { precision: 14, scale: 2 }),
  // La doc no define automatic_budget (api-research §8.4). Se guarda tal
  // cual llegó; null si el campo no vino. No se interpreta como
  // "presupuesto compartido".
  presupuestoAutomatico: boolean("presupuesto_automatico"),
  roasObjetivo: numeric("roas_objetivo", { precision: 6, scale: 2 }),
  acosObjetivo: numeric("acos_objetivo", { precision: 10, scale: 4 }),
  acosObjetivoCalculado: boolean("acos_objetivo_calculado").notNull().default(false),
  moneda: text("moneda"),
  creadaMlTs: timestamp("creada_ml_ts", { withTimezone: true }),
  actualizadaMlTs: timestamp("actualizada_ml_ts", { withTimezone: true }),
  sincronizadaTs: timestamp("sincronizada_ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  campanaUnica: uniqueIndex("publicidad_campanas_cuenta_campana_unica").on(t.empresaId, t.cuentaMlId, t.campanaIdMl),
}));

export const publicidadAnuncios = pgTable("publicidad_anuncios", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  adGroupId: text("ad_group_id").notNull(),
  tipoAdGroup: text("tipo_ad_group"),
  adGroupExternoId: text("ad_group_externo_id"),
  campanaIdMl: text("campana_id_ml"),
  itemId: text("item_id").notNull(),
  titulo: text("titulo"),
  permalink: text("permalink"),
  estado: text("estado"),
  precio: numeric("precio", { precision: 14, scale: 2 }),
  logisticType: text("logistic_type"),
  listingTypeId: text("listing_type_id"),
  sincronizadoTs: timestamp("sincronizado_ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  anuncioUnico: uniqueIndex("publicidad_anuncios_cuenta_grupo_item_unico").on(t.empresaId, t.cuentaMlId, t.adGroupId, t.itemId),
}));

export const publicidadMetricasDiarias = pgTable("publicidad_metricas_diarias", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  nivel: publicidadNivelMetricaEnum("nivel").notNull(),
  entidadIdMl: text("entidad_id_ml").notNull(),
  // Vacío en cuenta/campaña/ad group. En anuncio es el ad group: el
  // mismo ítem puede estar en dos grupos y no se pueden pisar.
  adGroupId: text("ad_group_id").notNull().default(""),
  fecha: date("fecha", { mode: "string" }).notNull(),
  clicks: integer("clicks"),
  impresiones: integer("impresiones"),
  costo: numeric("costo", { precision: 14, scale: 2 }),
  montoDirecto: numeric("monto_directo", { precision: 14, scale: 2 }),
  montoIndirecto: numeric("monto_indirecto", { precision: 14, scale: 2 }),
  montoTotal: numeric("monto_total", { precision: 14, scale: 2 }),
  unidadesDirectas: integer("unidades_directas"),
  unidadesIndirectas: integer("unidades_indirectas"),
  unidadesTotal: integer("unidades_total"),
  ventasPublicidad: integer("ventas_publicidad"),
  ventasOrganicasCant: integer("ventas_organicas_cant"),
  ventasOrganicasMonto: numeric("ventas_organicas_monto", { precision: 14, scale: 2 }),
  acos: numeric("acos", { precision: 10, scale: 4 }),
  roas: numeric("roas", { precision: 10, scale: 4 }),
  tacos: numeric("tacos", { precision: 10, scale: 4 }),
  sov: numeric("sov", { precision: 10, scale: 4 }),
  cvr: numeric("cvr", { precision: 10, scale: 4 }),
  ctr: numeric("ctr", { precision: 10, scale: 4 }),
  cpc: numeric("cpc", { precision: 14, scale: 2 }),
  sincronizadaTs: timestamp("sincronizada_ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  metricaUnica: uniqueIndex("publicidad_metricas_diarias_unica").on(
    t.empresaId,
    t.cuentaMlId,
    t.nivel,
    t.entidadIdMl,
    t.adGroupId,
    t.fecha
  ),
}));

export const publicidadCostosItem = pgTable("publicidad_costos_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  fecha: date("fecha", { mode: "string" }).notNull(),
  skuCodigo: text("sku_codigo"),
  categoryId: text("category_id"),
  precioVentaVigente: numeric("precio_venta_vigente", { precision: 14, scale: 2 }),
  precioRegular: numeric("precio_regular", { precision: 14, scale: 2 }),
  comisionMl: numeric("comision_ml", { precision: 14, scale: 2 }),
  comisionDetalle: jsonb("comision_detalle").$type<Record<string, unknown> | null>(),
  // Estimado de F9 (`coverage.all_country.list_cost`), una sola unidad.
  // 0 cuando el comprador paga el envío. No es el costo real de un
  // envío ya despachado.
  envioVendedorEstimado: numeric("envio_vendedor_estimado", { precision: 14, scale: 2 }),
  compradorPagaEnvio: boolean("comprador_paga_envio"),
  logisticType: text("logistic_type"),
  shippingMode: text("shipping_mode"),
  listingTypeId: text("listing_type_id"),
  consultadoTs: timestamp("consultado_ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  costoUnico: uniqueIndex("publicidad_costos_item_unico").on(t.empresaId, t.cuentaMlId, t.itemId, t.fecha),
}));

export const publicidadSincronizaciones = pgTable("publicidad_sincronizaciones", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
  origen: publicidadOrigenSyncEnum("origen").notNull(),
  solicitadaPor: uuid("solicitada_por").references(() => usuarios.id, { onDelete: "set null" }),
  rangoDesde: date("rango_desde", { mode: "string" }),
  rangoHasta: date("rango_hasta", { mode: "string" }),
  estado: publicidadEstadoSyncEnum("estado").notNull(),
  // true solo cuando el tramo cierra un backfill con acceso real a
  // Product Ads. Un ok de sin_product_ads o sin_permiso_app queda en
  // false: no cuenta como historial ya cubierto.
  cierraBackfill: boolean("cierra_backfill").notNull().default(false),
  // Día desde el que hay que retomar anuncios si la corrida se cortó
  // por tiempo. Un error real lo deja vacío: ese tramo se reintenta
  // entero, y al tercer fallo se avanza para no trabar el backfill.
  reanudaDesde: date("reanuda_desde", { mode: "string" }),
  llamadas: integer("llamadas").notNull().default(0),
  // Texto corto. Nunca un token, ni el cuerpo crudo de Mercado Libre.
  // En una corrida `ok` puede traer un aviso (forma de DAILY sin
  // confirmar), no solo un fallo.
  error: text("error"),
  iniciadaTs: timestamp("iniciada_ts", { withTimezone: true }).notNull().defaultNow(),
  terminadaTs: timestamp("terminada_ts", { withTimezone: true }),
}, (t) => ({
  // Una sola corrida en curso por empresa y cuenta. El id de la cuenta
  // no cambia al transferirla, así que la empresa va en la clave.
  enCursoUnica: uniqueIndex("publicidad_sincronizaciones_en_curso_unica")
    .on(t.empresaId, t.cuentaMlId)
    .where(sql`${t.estado} = 'en_curso'`),
}));
