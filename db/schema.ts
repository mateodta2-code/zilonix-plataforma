import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

// Rama feat-promociones — "aprobar"/"ejecutar" se agregan para el
// módulo promociones (decisión de Mateo: son 2 pasos reales distintos
// de un humano antes de que algo cambie de verdad en Mercado Libre,
// nunca el mismo permiso que "modificar" de otros módulos). Agregar un
// valor a un enum de Postgres SIEMPRE necesita su propia migración
// (ALTER TYPE ... ADD VALUE) — drizzle-kit la genera solo al correr
// `npm run db:generate` sobre este cambio, nunca a mano.
export const accionEnum = pgEnum("accion", ["consultar", "crear", "modificar", "anular", "autorizar", "aprobar", "ejecutar"]);
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
  // Una empresa por NIT/sociedad — decisión D2. Cada comercio (Zilonix,
  // Pachamama) es su propia fila de esta tabla. Los titulares son filas
  // de `titulares` dentro de esa empresa (issue #125, decisión de
  // Sharel); el NIT no se parte por titular. El issue pide ajustar solo
  // este comentario y deja la confirmación de la lectura en Mateo.
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
  // Issue #125 — qué registro cambió y el antes/después. Quedan vacíos
  // en las filas viejas y en acciones que no son un cambio (invitar,
  // sincronizar). Texto, no uuid: un id de Mercado Libre no siempre es
  // uuid. Documento, correo y WhatsApp no se escriben acá en claro
  // (lib/finanzas/enmascarar.ts).
  entidadId: text("entidad_id"),
  valorAnterior: text("valor_anterior"),
  valorNuevo: text("valor_nuevo"),
  detalle: text("detalle"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

// Issue #125 (Z-FIN-03) — persona o sociedad DENTRO de una empresa.
// No es otra fila de `empresas` (eso seguiría siendo D2, un NIT por
// empresa). Mateo confirma el comentario de D2; el enum en sí es el
// que pidió el issue.
export const tipoTitularEnum = pgEnum("tipo_titular", ["persona", "sociedad"]);

export const titulares = pgTable(
  "titulares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: tipoTitularEnum("tipo").notNull(),
    nombre: text("nombre").notNull(),
    documento: text("documento").notNull(),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // El par (empresa_id, id) es la clave que referencia la FK compuesta
    // de cuentas_ml. El id solo ya es único, pero Postgres exige un
    // UNIQUE que cubra exactamente las columnas referenciadas.
    empresaIdUnica: unique("titulares_empresa_id_unica").on(t.empresaId, t.id),
    // El mismo documento puede existir en otra empresa; en la misma, no.
    documentoUnico: unique("titulares_empresa_documento_unico").on(t.empresaId, t.documento),
  })
);

// Issue #125 — una fila por empresa. Sin fila, la app no inventa
// valores (ni 19 % de IVA ni otra cifra): leerConfiguracionFinanzas
// devuelve null. El default 3 de plazo_vencimiento_dias es de la
// columna, solo cuando la fila se inserta sin mandar ese campo.
// Los interruptores de aviso quedan vacíos (null) hasta que la
// empresa elija: el issue no les fija un valor.
export const configuracionFinanzas = pgTable(
  "configuracion_finanzas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    flexValor: numeric("flex_valor", { precision: 14, scale: 2 }),
    ivaPublicidad: numeric("iva_publicidad", { precision: 5, scale: 2 }),
    plazoVencimientoDias: integer("plazo_vencimiento_dias").notNull().default(3),
    avisoDiasAntes: integer("aviso_dias_antes"),
    avisoCorreoActivo: boolean("aviso_correo_activo"),
    avisoWhatsappActivo: boolean("aviso_whatsapp_activo"),
    avisoCorreoDestino: text("aviso_correo_destino"),
    avisoWhatsappDestino: text("aviso_whatsapp_destino"),
    actualizadaTs: timestamp("actualizada_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadaPor: uuid("actualizada_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    unaPorEmpresa: unique("configuracion_finanzas_empresa_unica").on(t.empresaId),
    plazoNoNegativo: check("configuracion_finanzas_plazo_no_negativo", sql`${t.plazoVencimientoDias} >= 0`),
    ivaRango: check(
      "configuracion_finanzas_iva_rango",
      sql`${t.ivaPublicidad} IS NULL OR (${t.ivaPublicidad} >= 0 AND ${t.ivaPublicidad} <= 100)`
    ),
  })
);

// Issue #125 — la meta no es una columna de configuracion_finanzas:
// cambia por empresa Y por mes (Sharel, 24-oct-2026). Mes sin fila =
// sin meta (no se asume 0 ni se copia el mes anterior). Quién puede
// cambiarla (solo el Dueño) lo revisa la acción de #126; acá la RLS
// solo aísla por empresa. Moneda por defecto COP: decisión de Mateo
// ya escrita en el issue.
export const metasMensuales = pgTable(
  "metas_mensuales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    mes: date("mes", { mode: "string" }).notNull(),
    metaUtilidad: numeric("meta_utilidad", { precision: 14, scale: 2 }).notNull(),
    moneda: text("moneda").notNull().default("COP"),
    actualizadaTs: timestamp("actualizada_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadaPor: uuid("actualizada_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    empresaMesMonedaUnica: unique("metas_mensuales_empresa_mes_moneda_unica").on(t.empresaId, t.mes, t.moneda),
    mesDiaUno: check("metas_mensuales_dia_uno", sql`extract(day from ${t.mes}) = 1`),
    utilidadNoNegativa: check("metas_mensuales_utilidad_no_negativa", sql`${t.metaUtilidad} >= 0`),
  })
);

// Issue #127 (Z-FIN-05) — proveedores y transportadores de la empresa.
// `tipo` es una etiqueta informativa: no limita qué conceptos cubre el
// tercero (el de agencia puede ser también el de empaque).
export const tipoTerceroEnum = pgEnum("tipo_tercero", ["proveedor_producto", "empaque", "agencia", "flex", "otro"]);
export const condicionPagoEnum = pgEnum("condicion_pago", ["inmediato", "cuenta_cobro", "anticipado_full_ml"]);
// El cierre de cada período es fijo: semana de lunes a domingo (cierra
// el domingo), quincenal el 15 y el último día del mes, mensual el
// último día.
export const periodicidadPagoEnum = pgEnum("periodicidad_pago", ["semanal", "quincenal", "mensual"]);

// Sin DELETE para app_user (db/rls-setup.sql): un tercero se desactiva
// con `activo`, nunca se borra, para no perder a quién se le debía.
export const terceros = pgTable(
  "terceros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    tipo: tipoTerceroEnum("tipo").notNull(),
    activo: boolean("activo").notNull().default(true),
    // Packing que cobra este proveedor, una vez por paquete. 0 = no
    // cobra (valor real); vacío = sin dato. Es el mismo para Full y
    // para agencia (Sharel, 24-oct-2026).
    empaque: numeric("empaque", { precision: 14, scale: 2 }),
    // Sin default de columna: agencia y flex nacen como cuenta_cobro
    // semanal (lib/terceros.ts); para los demás tipos se elige.
    condicionPago: condicionPagoEnum("condicion_pago").notNull(),
    periodicidad: periodicidadPagoEnum("periodicidad"),
    // Vacío = usa configuracion_finanzas.plazo_vencimiento_dias.
    plazoDias: integer("plazo_dias"),
    // Tercero habitual por concepto. Un mismo tercero puede tener
    // varias marcas (agencia y empaque suelen ser el mismo).
    predeterminadoEnvioAgencia: boolean("predeterminado_envio_agencia").notNull().default(false),
    predeterminadoEmpaque: boolean("predeterminado_empaque").notNull().default(false),
    predeterminadoFlex: boolean("predeterminado_flex").notNull().default(false),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPor: uuid("actualizado_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    // Destino de la FK compuesta de costos_sku. Constraint y no índice:
    // drizzle-kit crea los índices después de las claves foráneas.
    empresaIdUnica: unique("terceros_empresa_id_unica").on(t.empresaId, t.id),
    nombreUnico: unique("terceros_empresa_nombre_unico").on(t.empresaId, t.nombre),
    empaqueNoNegativo: check("terceros_empaque_no_negativo", sql`${t.empaque} >= 0`),
    plazoNoNegativo: check("terceros_plazo_no_negativo", sql`${t.plazoDias} >= 0`),
    cuentaCobroConPeriodicidad: check(
      "terceros_cuenta_cobro_con_periodicidad",
      sql`${t.condicionPago} <> 'cuenta_cobro' OR ${t.periodicidad} IS NOT NULL`
    ),
    // A lo sumo un tercero habitual por concepto y empresa.
    habitualEnvioAgencia: uniqueIndex("terceros_habitual_envio_agencia_unico")
      .on(t.empresaId)
      .where(sql`${t.predeterminadoEnvioAgencia}`),
    habitualEmpaque: uniqueIndex("terceros_habitual_empaque_unico").on(t.empresaId).where(sql`${t.predeterminadoEmpaque}`),
    habitualFlex: uniqueIndex("terceros_habitual_flex_unico").on(t.empresaId).where(sql`${t.predeterminadoFlex}`),
  })
);

export const fuenteCostoEnum = pgEnum("fuente_costo", ["manual", "archivo"]);

// Issue #127 (Z-FIN-05) — tabla maestra por SKU, como la hoja de
// Zilonix: una fila por SKU con lo que cuesta y los pisos de venta.
// La llave es el SKU de la publicación de Mercado Libre normalizado
// (trim + mayúsculas), no `skus`: sin FK hacia `skus`, la importación
// (#128) crea filas aunque el SKU no esté en el catálogo. El costo de
// cada venta lo congela #129/#130 y el historial va a `auditoria`, así
// que acá no hay vigencias.
//
// Ceros (Sharel, 22-oct-2026): costo vacío = sin costo (se alerta) y
// costo 0 = costo real de $0. Empaque y envío agencia 0 = $0 real.
// Precio mínimo 0 = no aplica, se guarda vacío (el CHECK > 0 lo
// impide en la base). Empaque vacío = usar el del proveedor.
export const costosSku = pgTable(
  "costos_sku",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    skuCodigo: text("sku_codigo").notNull(),
    nombreProducto: text("nombre_producto"),
    costo: numeric("costo", { precision: 14, scale: 2 }),
    empaque: numeric("empaque", { precision: 14, scale: 2 }),
    envioAgencia: numeric("envio_agencia", { precision: 14, scale: 2 }),
    // Pisos de venta por cantidad fija de unidades (1, 2 o 3), para el
    // agente de promociones. Son independientes entre sí.
    precioMinimoUnidad: numeric("precio_minimo_unidad", { precision: 14, scale: 2 }),
    precioMinimoComboX2: numeric("precio_minimo_combo_x2", { precision: 14, scale: 2 }),
    precioMinimoComboX3: numeric("precio_minimo_combo_x3", { precision: 14, scale: 2 }),
    precioVenta: numeric("precio_venta", { precision: 14, scale: 2 }),
    // Proveedor del producto. Vacío no bloquea la utilidad: solo queda
    // sin cuenta por pagar asociada (#140).
    terceroId: uuid("tercero_id"),
    fuente: fuenteCostoEnum("fuente").notNull().default("manual"),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPor: uuid("actualizado_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    skuUnico: unique("costos_sku_empresa_sku_unico").on(t.empresaId, t.skuCodigo),
    // La base rechaza un código sin normalizar: así " ab-1" y "AB-1"
    // nunca quedan como dos filas.
    skuNormalizado: check("costos_sku_sku_normalizado", sql`${t.skuCodigo} = upper(btrim(${t.skuCodigo})) AND ${t.skuCodigo} <> ''`),
    costoNoNegativo: check("costos_sku_costo_no_negativo", sql`${t.costo} >= 0`),
    empaqueNoNegativo: check("costos_sku_empaque_no_negativo", sql`${t.empaque} >= 0`),
    envioNoNegativo: check("costos_sku_envio_agencia_no_negativo", sql`${t.envioAgencia} >= 0`),
    precioVentaNoNegativo: check("costos_sku_precio_venta_no_negativo", sql`${t.precioVenta} >= 0`),
    minimoUnidadPositivo: check("costos_sku_precio_minimo_unidad_positivo", sql`${t.precioMinimoUnidad} > 0`),
    minimoX2Positivo: check("costos_sku_precio_minimo_combo_x2_positivo", sql`${t.precioMinimoComboX2} > 0`),
    minimoX3Positivo: check("costos_sku_precio_minimo_combo_x3_positivo", sql`${t.precioMinimoComboX3} > 0`),
    // Un SKU de la empresa A nunca apunta a un tercero de la empresa B.
    terceroDeLaEmpresa: foreignKey({
      name: "costos_sku_tercero_misma_empresa_fk",
      columns: [t.empresaId, t.terceroId],
      foreignColumns: [terceros.empresaId, terceros.id],
    }).onDelete("restrict"),
  })
);

// Tarea 2.3 — una cuenta de Mercado Libre conectada a una empresa.
// Tokens cifrados (lib/cifrado.ts, AES-256-GCM con versión de clave —
// regla de CLAUDE.md "tokens de marketplaces siempre cifrados"), nunca
// en texto plano ni en esta tabla ni en ningún log.
export const cuentasMl = pgTable(
  "cuentas_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    // Issue #125 — vacío hasta que alguien asigne titular. La FK no es
    // solo titular_id → titulares.id (eso dejaría colgar un titular de
    // otra empresa): es el par (empresa_id, titular_id). ON DELETE
    // RESTRICT: no se borra un titular que todavía tiene cuentas.
    // No se agrega `estado` (activa / requiere_reconexion /
    // desconectada): eso es el issue #59, otra migración.
    titularId: uuid("titular_id"),
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
    // Issue #315 (Z-LATAM-01) — sitio real de Mercado Libre de esta
    // cuenta (MCO/MLM/MLB/MLA/MLC), para que Seller funcione en otros
    // países de LATAM, no solo Colombia. Se llena al conectar/reconectar
    // (GET /users/me, vía lib/ml/oauth.ts — obtenerDatosVendedorMl) con
    // el site_id real que devuelve Mercado Libre; las filas que ya
    // existían quedan con el default (MCO) hasta que se reconecten.
    // Acotado con un CHECK (texto, no un enum de Postgres: agregar un
    // país nuevo más adelante es un ALTER TABLE simple, nunca el ALTER
    // TYPE fuera de transacción que exige un enum real).
    siteId: text("site_id").notNull().default("MCO"),
    // ISO 4217 — derivada de site_id vía lib/ml/sitios.ts (SITIOS_ML), no
    // algo que se vuelva a preguntar a Mercado Libre por separado.
    moneda: text("moneda").notNull().default("COP"),
    // Idioma/locale de la cuenta (formato BCP 47, ej. "es-CO", "pt-BR") —
    // misma fuente que moneda, vía lib/ml/sitios.ts.
    idioma: text("idioma").notNull().default("es-CO"),
  },
  (t) => ({
    // Una cuenta real de Mercado Libre no puede estar conectada a dos
    // empresas de Zilonix a la vez — evita ambigüedad de a quién le
    // pertenecen sus avisos y sus pedidos.
    cuentaUnica: uniqueIndex("cuentas_ml_cuenta_externa_unica").on(t.cuentaIdExterna),
    // Issue #315 — criterio de aceptación explícito: site_id solo puede
    // ser uno de los 5 sitios de Mercado Libre que de verdad opera
    // Zilonix en LATAM (Colombia, México, Brasil, Argentina, Chile).
    siteIdValido: check("cuentas_ml_site_id_valido", sql`${t.siteId} IN ('MCO', 'MLM', 'MLB', 'MLA', 'MLC')`),
    // MATCH SIMPLE (el default de Postgres): si titular_id es null, la
    // FK no se evalúa. Con valor, empresa_id + titular_id tienen que
    // existir juntos en titulares.
    titularDeLaMismaEmpresa: foreignKey({
      name: "cuentas_ml_empresa_titular_fk",
      columns: [t.empresaId, t.titularId],
      foreignColumns: [titulares.empresaId, titulares.id],
    }).onDelete("restrict"),
    // Code review de Pablo (rama feat-promociones) — igual que
    // skus_empresa_id_unica (0015) y bodegas_empresa_id_unica (0016):
    // Postgres exige que la columna referenciada por una FK compuesta
    // tenga su propio UNIQUE — promociones_reglas/candidatos/acciones
    // (migración 0017) referencian (empresa_id, cuenta_ml_id) contra
    // esto mismo. Sin este constraint, la migración 0017 fallaba de
    // verdad al correr contra Postgres real (nunca se notó local
    // porque drizzle-kit solo genera el SQL, no lo ejecuta).
    empresaIdUnica: unique("cuentas_ml_empresa_id_unica").on(t.empresaId, t.id),
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
    // Issue #129 — destino de la FK compuesta de pedidos_finanzas: la
    // cabecera financiera de la empresa A nunca apunta a un pedido de
    // B. Constraint y no índice: drizzle-kit crea los índices después
    // de las claves foráneas.
    empresaIdUnica: unique("pedidos_empresa_id_unica").on(t.empresaId, t.id),
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
    // Issue #280 — destino de las FK compuestas de stock_bodega,
    // kardex_movimientos y compras: una fila de inventario de la
    // empresa A nunca apunta a un SKU de B. Constraint y no índice:
    // drizzle-kit crea los índices después de las claves foráneas.
    empresaIdUnica: unique("skus_empresa_id_unica").on(t.empresaId, t.id),
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
    // Fase 1 de Despachos (issue "Despachos") — "expected_date" real de
    // GET /shipments/{id}/sla (lib/ml/cliente.ts) — la hora límite para
    // dejarlo en la agencia/recogida. Se guarda al sincronizar, nunca
    // se pide en vivo en cada carga de la pantalla (ese SLA no cambia
    // una vez el envío está armado, confirmado contra el código real
    // de zilonix-os-web).
    slaExpectedDate: timestamp("sla_expected_date", { withTimezone: true }),
    // "Ver guía" (normal o sticker) tiene que abrirse al menos una vez
    // antes de poder marcar despachado — gate real pedido en esta
    // tarea, nunca al revés. null = todavía no se abrió ninguna.
    guiaVistaTs: timestamp("guia_vista_ts", { withTimezone: true }),
    // "Marcar despachado" NUNCA llama a Mercado Libre (a propósito,
    // ver lib/ml/despachos.ts) — solo registra que ESTA persona, en
    // ESTE momento, confirmó que el paquete salió. "Deshacer" (10 min)
    // limpia los dos campos, nunca se guarda un historial de deshacer.
    despachadoTs: timestamp("despachado_ts", { withTimezone: true }),
    despachadoPor: uuid("despachado_por").references(() => usuarios.id, { onDelete: "set null" }),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shipmentUnico: uniqueIndex("despachos_ml_empresa_shipment_unico").on(t.empresaId, t.shipmentIdExterno),
  })
);

// Issue #129 (Z-FIN-07) — datos financieros de cada venta. `pedidos`
// no se toca (sigue siendo la Venta, solo con el total): lo de acá lo
// llena la sincronización de #130 y lo lee el motor de utilidad.
//
// Congelado: al sincronizar una venta por primera vez con costo
// completo se fijan costo, empaque y envío y no se recalculan; comisión
// y flete de ML sí se actualizan en cada sincronización. Una corrección
// manual activa (ventas_correcciones) siempre gana.
//
// Ceros: un costo, empaque o envío vacío es "sin dato"; 0.00 es $0
// real. Ningún monto es float.
//
// forma_entrega sale de la logística de ML (fulfillment → full_ml,
// self_service → flex, cross_docking / xd_drop_off / drop_off →
// agencia, otro → desconocida), nunca del prefijo del SKU.
export const formaEntregaEnum = pgEnum("forma_entrega", ["full_ml", "flex", "agencia", "desconocida"]);
export const estadoCosteoEnum = pgEnum("estado_costeo", ["completo", "parcial", "sin_costo"]);

// Cabecera financiera, 1:1 con `pedidos`. Sin DELETE para app_user: se
// borra solo en cascada con su pedido.
export const pedidosFinanzas = pgTable(
  "pedidos_finanzas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    // FK compuesta (empresa_id, pedido_id) → pedidos, abajo.
    pedidoId: uuid("pedido_id").notNull(),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    formaEntrega: formaEntregaEnum("forma_entrega").notNull().default("desconocida"),
    // Se guarda como dato; la vista de detalle agrupa por pedidos.fecha
    // (date_created de ML) y, más adelante, por fecha_despacho.
    fechaPagoAprobado: timestamp("fecha_pago_aprobado", { withTimezone: true }),
    // Lo que pagó el cliente (pagos aprobados), SIN restar reembolsos
    // (Sharel, 24-oct-2026). "Con devolución" = reembolsos > 0, se
    // calcula.
    valorVenta: numeric("valor_venta", { precision: 14, scale: 2 }).notNull(),
    reembolsos: numeric("reembolsos", { precision: 14, scale: 2 }).notNull().default("0.00"),
    comisionMl: numeric("comision_ml", { precision: 14, scale: 2 }),
    fleteMl: numeric("flete_ml", { precision: 14, scale: 2 }),
    // La parte de esta orden del cargo de su paquete (uno solo por
    // paquete, el mayor de sus SKU). Tiene que dar la suma de sus
    // líneas (lo valida el motor, #162). En Full el empaque se cobra y
    // el envío es $0.
    empaqueCongelado: numeric("empaque_congelado", { precision: 14, scale: 2 }),
    envioAgenciaCongelado: numeric("envio_agencia_congelado", { precision: 14, scale: 2 }),
    estadoCosteo: estadoCosteoEnum("estado_costeo").notNull().default("sin_costo"),
    // Vacío = todavía no se congeló.
    congeladoTs: timestamp("congelado_ts", { withTimezone: true }),
    cancelada: boolean("cancelada").notNull().default(false),
    sincronizadoTs: timestamp("sincronizado_ts", { withTimezone: true }).notNull().defaultNow(),
    // Paquete = el envío de ML (shipping.id, el mismo shipment_id de
    // despachos_ml). Un carrito puede ser varias órdenes con el mismo
    // envío, así que no es único. pack_id es solo dato: ML puede partir
    // un carrito en varios envíos. Llave del paquete (se calcula):
    // shipment, si no pack, si no pedido_id.
    shipmentIdExterno: text("shipment_id_externo"),
    packIdExterno: text("pack_id_externo"),
    // status_history.date_shipped / date_delivered del envío.
    fechaDespacho: timestamp("fecha_despacho", { withTimezone: true }),
    fechaEntrega: timestamp("fecha_entrega", { withTimezone: true }),
  },
  (t) => ({
    pedidoUnico: unique("pedidos_finanzas_pedido_unico").on(t.pedidoId),
    delPedido: foreignKey({
      name: "pedidos_finanzas_pedido_misma_empresa_fk",
      columns: [t.empresaId, t.pedidoId],
      foreignColumns: [pedidos.empresaId, pedidos.id],
    }).onDelete("cascade"),
    // Destino de las FK compuestas de pedido_items y
    // ventas_correcciones: una línea o corrección de la empresa A nunca
    // cuelga de una venta de B.
    empresaPedidoUnico: unique("pedidos_finanzas_empresa_pedido_unico").on(t.empresaId, t.pedidoId),
    porShipment: index("pedidos_finanzas_empresa_shipment_idx").on(t.empresaId, t.shipmentIdExterno),
    porFechaDespacho: index("pedidos_finanzas_empresa_fecha_despacho_idx").on(t.empresaId, t.fechaDespacho),
    valorVentaNoNegativo: check("pedidos_finanzas_valor_venta_no_negativo", sql`${t.valorVenta} >= 0`),
    reembolsosNoNegativos: check("pedidos_finanzas_reembolsos_no_negativos", sql`${t.reembolsos} >= 0`),
    comisionNoNegativa: check("pedidos_finanzas_comision_ml_no_negativa", sql`${t.comisionMl} >= 0`),
    fleteNoNegativo: check("pedidos_finanzas_flete_ml_no_negativo", sql`${t.fleteMl} >= 0`),
    empaqueNoNegativo: check("pedidos_finanzas_empaque_no_negativo", sql`${t.empaqueCongelado} >= 0`),
    envioNoNegativo: check("pedidos_finanzas_envio_agencia_no_negativo", sql`${t.envioAgenciaCongelado} >= 0`),
  })
);

// Líneas de la venta, con su foto congelada. Sin DELETE para app_user.
export const pedidoItems = pgTable(
  "pedido_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoId: uuid("pedido_id").notNull(),
    linea: integer("linea").notNull(),
    publicacionId: uuid("publicacion_id").references(() => publicaciones.id, { onDelete: "set null" }),
    itemIdExterno: text("item_id_externo").notNull(),
    // SKU de la publicación de ML normalizado (trim + mayúsculas): es la
    // llave para buscar el costo en costos_sku. Vacío si ML no trae SKU.
    skuCodigo: text("sku_codigo"),
    // Solo informativo: se llena si el código existe en `skus`.
    skuId: uuid("sku_id").references(() => skus.id, { onDelete: "set null" }),
    cantidad: integer("cantidad").notNull(),
    precioUnitario: numeric("precio_unitario", { precision: 14, scale: 2 }).notNull(),
    valorLinea: numeric("valor_linea", { precision: 14, scale: 2 }).notNull(),
    // Reparto de la línea de lo que cobra ML a la orden.
    comisionMl: numeric("comision_ml", { precision: 14, scale: 2 }),
    fleteMl: numeric("flete_ml", { precision: 14, scale: 2 }),
    // Vacío = sin costo; 0.00 = costo real de $0.
    costoCongelado: numeric("costo_congelado", { precision: 14, scale: 2 }),
    // order_item.item.title al vender: no cambia si cambia la publicación.
    titulo: text("titulo").notNull(),
    // Dirección de la miniatura de la publicación (no se guarda la imagen).
    imagenUrl: text("imagen_url"),
    // La parte de la línea del empaque y el envío del paquete (reparto
    // por peso, solo para que las filas sumen). Vacío = sin dato.
    empaqueCongelado: numeric("empaque_congelado", { precision: 14, scale: 2 }),
    envioCongelado: numeric("envio_congelado", { precision: 14, scale: 2 }),
  },
  (t) => ({
    lineaUnica: unique("pedido_items_pedido_linea_unica").on(t.pedidoId, t.linea),
    deLaVenta: foreignKey({
      name: "pedido_items_venta_misma_empresa_fk",
      columns: [t.empresaId, t.pedidoId],
      foreignColumns: [pedidosFinanzas.empresaId, pedidosFinanzas.pedidoId],
    }).onDelete("cascade"),
    lineaPositiva: check("pedido_items_linea_positiva", sql`${t.linea} >= 1`),
    cantidadPositiva: check("pedido_items_cantidad_positiva", sql`${t.cantidad} > 0`),
    skuNormalizado: check("pedido_items_sku_normalizado", sql`${t.skuCodigo} = upper(btrim(${t.skuCodigo})) AND ${t.skuCodigo} <> ''`),
    precioNoNegativo: check("pedido_items_precio_unitario_no_negativo", sql`${t.precioUnitario} >= 0`),
    valorNoNegativo: check("pedido_items_valor_linea_no_negativo", sql`${t.valorLinea} >= 0`),
    comisionNoNegativa: check("pedido_items_comision_ml_no_negativa", sql`${t.comisionMl} >= 0`),
    fleteNoNegativo: check("pedido_items_flete_ml_no_negativo", sql`${t.fleteMl} >= 0`),
    costoNoNegativo: check("pedido_items_costo_no_negativo", sql`${t.costoCongelado} >= 0`),
    empaqueNoNegativo: check("pedido_items_empaque_no_negativo", sql`${t.empaqueCongelado} >= 0`),
    envioNoNegativo: check("pedido_items_envio_no_negativo", sql`${t.envioCongelado} >= 0`),
  })
);

// Correcciones manuales: no se editan ni se borran. Corregir de nuevo =
// anular la activa y crear otra fila. app_user solo puede hacer UPDATE
// de anulada_ts, y solo para anular (db/rls-setup.sql).
export const CAMPOS_CORRECCION_VENTA = ["costo_producto", "empaque", "envio_agencia", "comision_ml", "flete_ml"] as const;
export type CampoCorreccionVenta = (typeof CAMPOS_CORRECCION_VENTA)[number];

export const ventasCorrecciones = pgTable(
  "ventas_correcciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoId: uuid("pedido_id").notNull(),
    // Vacío = toda la orden.
    linea: integer("linea"),
    campo: text("campo").$type<CampoCorreccionVenta>().notNull(),
    valorNuevo: numeric("valor_nuevo", { precision: 14, scale: 2 }).notNull(),
    nota: text("nota").notNull(),
    creadoPor: uuid("creado_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    anuladaTs: timestamp("anulada_ts", { withTimezone: true }),
  },
  (t) => ({
    deLaVenta: foreignKey({
      name: "ventas_correcciones_venta_misma_empresa_fk",
      columns: [t.empresaId, t.pedidoId],
      foreignColumns: [pedidosFinanzas.empresaId, pedidosFinanzas.pedidoId],
    }).onDelete("cascade"),
    // MATCH SIMPLE: con linea vacía (toda la orden) no se evalúa.
    deLaLinea: foreignKey({
      name: "ventas_correcciones_linea_fk",
      columns: [t.pedidoId, t.linea],
      foreignColumns: [pedidoItems.pedidoId, pedidoItems.linea],
    }).onDelete("cascade"),
    // Lista cerrada en la base, no solo en la app.
    campoValido: check(
      "ventas_correcciones_campo_valido",
      sql`${t.campo} IN ('costo_producto', 'empaque', 'envio_agencia', 'comision_ml', 'flete_ml')`
    ),
    valorNoNegativo: check("ventas_correcciones_valor_no_negativo", sql`${t.valorNuevo} >= 0`),
    notaConTexto: check("ventas_correcciones_nota_con_texto", sql`btrim(${t.nota}) <> ''`),
    // Una sola corrección activa por (pedido, linea, campo). coalesce
    // para que dos correcciones de toda la orden (linea vacía) también
    // choquen: en un índice único dos NULL no son iguales.
    unaActiva: uniqueIndex("ventas_correcciones_una_activa")
      .on(t.pedidoId, sql`coalesce(${t.linea}, 0)`, t.campo)
      .where(sql`${t.anuladaTs} IS NULL`),
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

// ---------------------------------------------------------------------
// Issue #280 — WMS Fase 1: bodegas, stock por SKU y bodega, kardex y
// compras. Seller es la fuente de verdad del inventario (no Fulfy).
// Todo en unidades enteras: no hay fracciones de producto. Sin
// ubicaciones dentro de la bodega (fuera de Fase 1).
//
// Una sola puerta de escritura: lib/inventario/movimientos.ts
// (aplicarMovimientos). Ninguna otra parte del código actualiza
// stock_bodega a mano: cada cambio deja su fila en el kardex en la
// misma transacción, y el kardex nunca se edita ni se borra (app_user
// solo tiene SELECT e INSERT, db/rls-setup.sql).
// ---------------------------------------------------------------------

// fulfillment_ml = el stock que Mercado Libre guarda en Full. No se
// suma al disponible que se publica (ML ya lo conoce por su lado) y no
// se reserva para pedidos: Full despacha solo.
export const tipoBodegaEnum = pgEnum("tipo_bodega", ["propia", "fulfillment_ml", "tercero"]);

export const bodegas = pgTable(
  "bodegas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    tipo: tipoBodegaEnum("tipo").notNull().default("propia"),
    // La primera que se intenta para reservar un pedido de ML.
    esPrincipal: boolean("es_principal").notNull().default(false),
    // Una bodega se desactiva, nunca se borra: su kardex sigue siendo
    // historia real.
    activa: boolean("activa").notNull().default(true),
    // Si su disponible cuenta para lo que se publica en ML. Nace en
    // false para fulfillment_ml (lib/inventario/bodegas.ts).
    sumaAlPublicado: boolean("suma_al_publicado").notNull().default(true),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    empresaIdUnica: unique("bodegas_empresa_id_unica").on(t.empresaId, t.id),
    nombreUnico: unique("bodegas_empresa_nombre_unico").on(t.empresaId, t.nombre),
    // A lo sumo una principal por empresa.
    principalUnica: uniqueIndex("bodegas_principal_unica").on(t.empresaId).where(sql`${t.esPrincipal}`),
    nombreNoVacio: check("bodegas_nombre_no_vacio", sql`btrim(${t.nombre}) <> ''`),
  })
);

// Saldo actual de un SKU en una bodega. Los kits no tienen fila acá:
// su stock se deriva de sus componentes (lib/inventario/calculos.ts).
// en_transito queda en 0 en Fase 1 (el traslado es instantáneo); la
// columna existe para la 1.1 sin otra migración.
export const stockBodega = pgTable(
  "stock_bodega",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    bodegaId: uuid("bodega_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    disponible: integer("disponible").notNull().default(0),
    reservado: integer("reservado").notNull().default(0),
    enTransito: integer("en_transito").notNull().default(0),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuBodegaUnico: unique("stock_bodega_sku_bodega_unico").on(t.empresaId, t.bodegaId, t.skuId),
    deLaBodega: foreignKey({
      name: "stock_bodega_bodega_misma_empresa_fk",
      columns: [t.empresaId, t.bodegaId],
      foreignColumns: [bodegas.empresaId, bodegas.id],
    }).onDelete("restrict"),
    delSku: foreignKey({
      name: "stock_bodega_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("restrict"),
    porSku: index("stock_bodega_empresa_sku_idx").on(t.empresaId, t.skuId),
    // La última defensa contra vender lo que no hay: aunque un bug se
    // saltara la validación de aplicarMovimientos, la base no deja un
    // saldo negativo.
    disponibleNoNegativo: check("stock_bodega_disponible_no_negativo", sql`${t.disponible} >= 0`),
    reservadoNoNegativo: check("stock_bodega_reservado_no_negativo", sql`${t.reservado} >= 0`),
    enTransitoNoNegativo: check("stock_bodega_en_transito_no_negativo", sql`${t.enTransito} >= 0`),
  })
);

// Qué hace cada tipo con el saldo (lib/inventario/calculos.ts):
// entrada +disponible · salida −disponible · ajuste ±disponible ·
// traslado −disponible en origen y +disponible en destino (dos filas,
// mismo grupo) · reserva −disponible +reservado · liberacion
// −reservado +disponible · confirmacion −reservado (la unidad salió).
export const tipoMovimientoEnum = pgEnum("tipo_movimiento", [
  "entrada",
  "salida",
  "ajuste",
  "traslado",
  "reserva",
  "liberacion",
  "confirmacion",
]);
// De dónde viene el movimiento: lo que dispara un pedido de ML nunca
// se confunde con un ajuste a mano.
export const origenMovimientoEnum = pgEnum("origen_movimiento", ["manual", "recepcion", "pedido_ml", "traslado"]);

// Kardex append-only. Cada fila guarda el cambio (delta) y el saldo que
// quedó después, así una auditoría no tiene que recalcular nada.
export const kardexMovimientos = pgTable(
  "kardex_movimientos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    // Las filas de una misma operación (las dos puntas de un traslado,
    // las líneas de una recepción o de un pedido) comparten grupo.
    grupoId: uuid("grupo_id").notNull(),
    linea: integer("linea").notNull(),
    // Idempotencia: la misma operación nunca se aplica dos veces (un
    // aviso de ML repetido, un doble clic). Ej. "pedido:<id>:reserva".
    claveIdempotencia: text("clave_idempotencia").notNull(),
    tipo: tipoMovimientoEnum("tipo").notNull(),
    origen: origenMovimientoEnum("origen").notNull(),
    bodegaId: uuid("bodega_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    deltaDisponible: integer("delta_disponible").notNull(),
    deltaReservado: integer("delta_reservado").notNull(),
    deltaEnTransito: integer("delta_en_transito").notNull().default(0),
    saldoDisponible: integer("saldo_disponible").notNull(),
    saldoReservado: integer("saldo_reservado").notNull(),
    saldoEnTransito: integer("saldo_en_transito").notNull().default(0),
    // Id de lo que lo originó (pedido, recepción). Texto: puede ser un
    // uuid propio o, en el futuro, un id externo.
    referenciaId: text("referencia_id"),
    // Se separa siempre la persona del sistema (mismo criterio que
    // auditoria y pedido_eventos).
    actorTipo: actorTipoEnum("actor_tipo").notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    nota: text("nota"),
  },
  (t) => ({
    claveUnica: unique("kardex_movimientos_clave_linea_unica").on(t.empresaId, t.claveIdempotencia, t.linea),
    deLaBodega: foreignKey({
      name: "kardex_movimientos_bodega_misma_empresa_fk",
      columns: [t.empresaId, t.bodegaId],
      foreignColumns: [bodegas.empresaId, bodegas.id],
    }).onDelete("restrict"),
    delSku: foreignKey({
      name: "kardex_movimientos_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("restrict"),
    porSkuTs: index("kardex_movimientos_empresa_sku_ts_idx").on(t.empresaId, t.skuId, t.ts),
    porBodegaTs: index("kardex_movimientos_empresa_bodega_ts_idx").on(t.empresaId, t.bodegaId, t.ts),
    porReferencia: index("kardex_movimientos_empresa_referencia_idx").on(t.empresaId, t.referenciaId),
    lineaPositiva: check("kardex_movimientos_linea_positiva", sql`${t.linea} >= 1`),
    claveNoVacia: check("kardex_movimientos_clave_no_vacia", sql`btrim(${t.claveIdempotencia}) <> ''`),
    // Un movimiento que no mueve nada no es un movimiento.
    mueveAlgo: check(
      "kardex_movimientos_mueve_algo",
      sql`${t.deltaDisponible} <> 0 OR ${t.deltaReservado} <> 0 OR ${t.deltaEnTransito} <> 0`
    ),
    saldosNoNegativos: check(
      "kardex_movimientos_saldos_no_negativos",
      sql`${t.saldoDisponible} >= 0 AND ${t.saldoReservado} >= 0 AND ${t.saldoEnTransito} >= 0`
    ),
  })
);

// Orden de compra simple: a quién, a qué bodega llega y qué SKUs. El
// estado parcial/recibida lo calcula la recepción, nunca se escribe a
// mano.
export const estadoOrdenCompraEnum = pgEnum("estado_orden_compra", ["abierta", "parcial", "recibida", "anulada"]);

export const ordenesCompra = pgTable(
  "ordenes_compra",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    // Consecutivo legible por empresa (OC-1, OC-2...), lo asigna lib/inventario/compras.ts.
    numero: integer("numero").notNull(),
    // Proveedor de la tabla de terceros (opcional: una compra de
    // contado puede no tener tercero creado todavía).
    terceroId: uuid("tercero_id"),
    bodegaDestinoId: uuid("bodega_destino_id").notNull(),
    estado: estadoOrdenCompraEnum("estado").notNull().default("abierta"),
    nota: text("nota"),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    creadoPor: uuid("creado_por").references(() => usuarios.id, { onDelete: "set null" }),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    empresaIdUnica: unique("ordenes_compra_empresa_id_unica").on(t.empresaId, t.id),
    numeroUnico: unique("ordenes_compra_empresa_numero_unico").on(t.empresaId, t.numero),
    delTercero: foreignKey({
      name: "ordenes_compra_tercero_misma_empresa_fk",
      columns: [t.empresaId, t.terceroId],
      foreignColumns: [terceros.empresaId, terceros.id],
    }).onDelete("restrict"),
    deLaBodega: foreignKey({
      name: "ordenes_compra_bodega_misma_empresa_fk",
      columns: [t.empresaId, t.bodegaDestinoId],
      foreignColumns: [bodegas.empresaId, bodegas.id],
    }).onDelete("restrict"),
    numeroPositivo: check("ordenes_compra_numero_positivo", sql`${t.numero} >= 1`),
  })
);

export const ordenCompraItems = pgTable(
  "orden_compra_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    ordenCompraId: uuid("orden_compra_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    cantidadPedida: integer("cantidad_pedida").notNull(),
    // La suma de lo recibido contra esta línea. Puede pasarse de lo
    // pedido (el proveedor mandó de más): se recibe lo que llegó.
    cantidadRecibida: integer("cantidad_recibida").notNull().default(0),
    // Vacío = sin dato. El costo oficial sigue en costos_sku (finanzas).
    costoUnitario: numeric("costo_unitario", { precision: 14, scale: 2 }),
  },
  (t) => ({
    empresaIdUnica: unique("orden_compra_items_empresa_id_unica").on(t.empresaId, t.id),
    skuUnicoPorOrden: unique("orden_compra_items_orden_sku_unico").on(t.ordenCompraId, t.skuId),
    deLaOrden: foreignKey({
      name: "orden_compra_items_orden_misma_empresa_fk",
      columns: [t.empresaId, t.ordenCompraId],
      foreignColumns: [ordenesCompra.empresaId, ordenesCompra.id],
    }).onDelete("cascade"),
    delSku: foreignKey({
      name: "orden_compra_items_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("restrict"),
    pedidaPositiva: check("orden_compra_items_pedida_positiva", sql`${t.cantidadPedida} > 0`),
    recibidaNoNegativa: check("orden_compra_items_recibida_no_negativa", sql`${t.cantidadRecibida} >= 0`),
    costoNoNegativo: check("orden_compra_items_costo_no_negativo", sql`${t.costoUnitario} >= 0`),
  })
);

// Una recepción es lo que de verdad llegó, contra una OC o directo
// (orden_compra_id vacío). Cada línea entra al kardex como "entrada".
export const recepciones = pgTable(
  "recepciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    ordenCompraId: uuid("orden_compra_id"),
    bodegaId: uuid("bodega_id").notNull(),
    nota: text("nota"),
    recibidoTs: timestamp("recibido_ts", { withTimezone: true }).notNull().defaultNow(),
    recibidoPor: uuid("recibido_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    empresaIdUnica: unique("recepciones_empresa_id_unica").on(t.empresaId, t.id),
    deLaOrden: foreignKey({
      name: "recepciones_orden_misma_empresa_fk",
      columns: [t.empresaId, t.ordenCompraId],
      foreignColumns: [ordenesCompra.empresaId, ordenesCompra.id],
    }).onDelete("restrict"),
    deLaBodega: foreignKey({
      name: "recepciones_bodega_misma_empresa_fk",
      columns: [t.empresaId, t.bodegaId],
      foreignColumns: [bodegas.empresaId, bodegas.id],
    }).onDelete("restrict"),
  })
);

export const recepcionItems = pgTable(
  "recepcion_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    recepcionId: uuid("recepcion_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    // Vacío en un ingreso directo.
    ordenCompraItemId: uuid("orden_compra_item_id"),
    cantidad: integer("cantidad").notNull(),
  },
  (t) => ({
    deLaRecepcion: foreignKey({
      name: "recepcion_items_recepcion_misma_empresa_fk",
      columns: [t.empresaId, t.recepcionId],
      foreignColumns: [recepciones.empresaId, recepciones.id],
    }).onDelete("cascade"),
    delSku: foreignKey({
      name: "recepcion_items_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("restrict"),
    deLaLineaOc: foreignKey({
      name: "recepcion_items_linea_oc_misma_empresa_fk",
      columns: [t.empresaId, t.ordenCompraItemId],
      foreignColumns: [ordenCompraItems.empresaId, ordenCompraItems.id],
    }).onDelete("restrict"),
    cantidadPositiva: check("recepcion_items_cantidad_positiva", sql`${t.cantidad} > 0`),
  })
);

// Regla de la última unidad: qué hacer cuando el disponible publicado de
// un SKU baja al umbral (por defecto 1) y la publicación tiene promos.
// preguntar = banner con Aplicar / No aplicar. quitar_promos y
// vender_sin_promo también pasan por el banner en Fase 1: la API de
// promociones no está en lib/ml/cliente.ts (ver docs/wms-fase1.md).
export const reglaUltimaUnidadEnum = pgEnum("regla_ultima_unidad", ["preguntar", "quitar_promos", "vender_sin_promo"]);

export const configuracionInventario = pgTable(
  "configuracion_inventario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    reglaUltimaUnidad: reglaUltimaUnidadEnum("regla_ultima_unidad").notNull().default("preguntar"),
    umbralUltimaUnidad: integer("umbral_ultima_unidad").notNull().default(1),
    // Unidades que se guardan sin publicar (colchón contra sobreventa).
    bufferMl: integer("buffer_ml").notNull().default(0),
    // Apagado por defecto: nada se escribe en ML hasta que la empresa
    // lo prenda a propósito, después de cargar su stock real.
    syncMlActivo: boolean("sync_ml_activo").notNull().default(false),
    // Solo los pedidos de ML creados desde este momento reservan stock.
    // Vacío = todavía no se reserva nada. Sin esto, la importación
    // inicial (60 días de pedidos ya despachados) descontaría del stock
    // real unidades que salieron antes de contarlo.
    reservaPedidosDesdeTs: timestamp("reserva_pedidos_desde_ts", { withTimezone: true }),
    actualizadaTs: timestamp("actualizada_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadaPor: uuid("actualizada_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    unaPorEmpresa: unique("configuracion_inventario_empresa_unica").on(t.empresaId),
    umbralNoNegativo: check("configuracion_inventario_umbral_no_negativo", sql`${t.umbralUltimaUnidad} >= 0`),
    bufferNoNegativo: check("configuracion_inventario_buffer_no_negativo", sql`${t.bufferMl} >= 0`),
  })
);

// Estado del envío de stock a ML por SKU. Sirve de cola con espera
// (debounce): cada movimiento marca pendiente_desde, y el trabajo solo
// envía los que llevan quietos un rato, así diez movimientos seguidos
// del mismo SKU son un solo PUT a ML.
export const syncStockMl = pgTable(
  "sync_stock_ml",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    skuId: uuid("sku_id").notNull(),
    pendienteDesdeTs: timestamp("pendiente_desde_ts", { withTimezone: true }),
    ultimoEnvioTs: timestamp("ultimo_envio_ts", { withTimezone: true }),
    ultimaCantidadEnviada: integer("ultima_cantidad_enviada"),
    // Texto corto para la pantalla. Nunca un token ni el cuerpo crudo de ML.
    ultimoResultado: text("ultimo_resultado"),
  },
  (t) => ({
    skuUnico: unique("sync_stock_ml_empresa_sku_unico").on(t.empresaId, t.skuId),
    delSku: foreignKey({
      name: "sync_stock_ml_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("cascade"),
    porPendiente: index("sync_stock_ml_empresa_pendiente_idx").on(t.empresaId, t.pendienteDesdeTs),
  })
);

export const estadoAlertaUltimaUnidadEnum = pgEnum("estado_alerta_ultima_unidad", ["pendiente", "aplicada", "descartada"]);

// Banner de la última unidad. Una sola alerta pendiente por SKU: si
// vuelve a bajar mientras sigue pendiente, no se apila otra.
export const alertasUltimaUnidad = pgTable(
  "alertas_ultima_unidad",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    skuId: uuid("sku_id").notNull(),
    disponibleAlCrear: integer("disponible_al_crear").notNull(),
    regla: reglaUltimaUnidadEnum("regla").notNull(),
    estado: estadoAlertaUltimaUnidadEnum("estado").notNull().default("pendiente"),
    creadaTs: timestamp("creada_ts", { withTimezone: true }).notNull().defaultNow(),
    resueltaTs: timestamp("resuelta_ts", { withTimezone: true }),
    resueltaPor: uuid("resuelta_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    delSku: foreignKey({
      name: "alertas_ultima_unidad_sku_misma_empresa_fk",
      columns: [t.empresaId, t.skuId],
      foreignColumns: [skus.empresaId, skus.id],
    }).onDelete("cascade"),
    pendienteUnica: uniqueIndex("alertas_ultima_unidad_pendiente_unica")
      .on(t.empresaId, t.skuId)
      .where(sql`${t.estado} = 'pendiente'`),
    resueltaConFecha: check(
      "alertas_ultima_unidad_resuelta_con_fecha",
      sql`(${t.estado} = 'pendiente') = (${t.resueltaTs} IS NULL)`
    ),
  })
);

// Rama feat-promociones — motor portado de zilonix-os-web
// (lib/mercadolibre-promo.js, docs/investigacion/promociones-mercado-libre.md
// de ese repo), generalizado para cualquier empresa: nunca una app de
// Mercado Libre aparte (reusa el token normal de cuentas_ml), nunca
// una regla global ni la clasificación suplemento/importación —
// reglas por cuenta, piso siempre desde costos_sku (Finanzas).

// Reglas del agente, UNA fila por cuenta de Mercado Libre conectada —
// nunca una sola regla global para toda la empresa (decisión de
// Mateo, al revés de zilonix-os-web). "Usar las mismas reglas para
// todas las cuentas" (la UI) es una COPIA explícita de un clic, no un
// vínculo que las mantenga sincronizadas después — por eso no hay
// ninguna columna acá para eso, cada fila sigue siendo independiente.
export const promocionesReglas = pgTable(
  "promociones_reglas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    descuentoMaximoPct: integer("descuento_maximo_pct").notNull().default(20),
    participarCompartidas: boolean("participar_compartidas").notNull().default(false),
    igualarAlPiso: boolean("igualar_al_piso").notNull().default(true),
    // "HH:MM" en hora de Colombia, o NULL = apagada (nunca corre sola).
    // Validado en código, no acá — mismo criterio que el resto del
    // repo para evitar un tipo de columna exótico sin precedente.
    busquedaAutomaticaHora: text("busqueda_automatica_hora"),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPor: uuid("actualizado_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    unaPorCuenta: unique("promociones_reglas_cuenta_unica").on(t.cuentaMlId),
    descuentoEnRango: check("promociones_reglas_descuento_rango", sql`${t.descuentoMaximoPct} > 0 AND ${t.descuentoMaximoPct} <= 100`),
    cuentaDeLaEmpresa: foreignKey({
      name: "promociones_reglas_empresa_cuenta_fk",
      columns: [t.empresaId, t.cuentaMlId],
      foreignColumns: [cuentasMl.empresaId, cuentasMl.id],
    }).onDelete("cascade"),
  })
);

// Snapshot de la última búsqueda real contra Mercado Libre — se
// sobreescribe (upsert) cada vez que se vuelve a buscar, nunca se
// acumula historial acá (el historial real de decisiones/ejecución es
// `promociones_acciones`, abajo). "precio_minimo" NULL = sin SKU o sin
// precio mínimo en costos_sku — ese producto queda bloqueado para
// participar, nunca se inventa un piso (regla no negociable de Mateo).
export const promocionesCandidatos = pgTable(
  "promociones_candidatos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    skuCodigo: text("sku_codigo"),
    tituloProducto: text("titulo_producto"),
    thumbnail: text("thumbnail"),
    tieneVariantes: boolean("tiene_variantes").notNull().default(false),
    // Tipo real de Mercado Libre (DEAL, PRICE_DISCOUNT, LIGHTNING,
    // SMART, UNHEALTHY_STOCK...) — texto libre a propósito, nunca un
    // enum de Postgres: la lista la controla Mercado Libre, no
    // nosotros (ver TIPOS_SIN_ESCRITURA_API en lib/ml/promociones.ts).
    tipoPromocion: text("tipo_promocion").notNull(),
    promotionIdMl: text("promotion_id_ml"),
    // Estado real que da Mercado Libre: "started"/"pending"/"candidate".
    estadoMl: text("estado_ml").notNull(),
    esCompartida: boolean("es_compartida").notNull().default(false),
    // true si tipoPromocion está en TIPOS_SIN_ESCRITURA_API — Mercado
    // Libre nunca deja escribir este tipo por la API de Promociones.
    soloEnMl: boolean("solo_en_ml").notNull().default(false),
    precioOriginal: numeric("precio_original", { precision: 14, scale: 2 }),
    precioActual: numeric("precio_actual", { precision: 14, scale: 2 }),
    precioMinimo: numeric("precio_minimo", { precision: 14, scale: 2 }),
    precioSugerido: numeric("precio_sugerido", { precision: 14, scale: 2 }),
    maxDiscountedPrice: numeric("max_discounted_price", { precision: 14, scale: 2 }),
    gananciaEstimada: numeric("ganancia_estimada", { precision: 14, scale: 2 }),
    cumpleReglas: boolean("cumple_reglas").notNull().default(false),
    motivoRevisarManual: text("motivo_revisar_manual"),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    candidatoUnico: unique("promociones_candidatos_unico").on(t.cuentaMlId, t.itemId, t.tipoPromocion),
    cuentaDeLaEmpresa: foreignKey({
      name: "promociones_candidatos_empresa_cuenta_fk",
      columns: [t.empresaId, t.cuentaMlId],
      foreignColumns: [cuentasMl.empresaId, cuentasMl.id],
    }).onDelete("cascade"),
    porEmpresa: index("promociones_candidatos_empresa_idx").on(t.empresaId),
  })
);

export const promocionAccionTipoEnum = pgEnum("promocion_accion_tipo", ["participar", "modificar", "salir"]);
export const promocionAccionEstadoEnum = pgEnum("promocion_accion_estado", ["pendiente", "aceptada", "rechazada", "ejecutada", "fallida"]);

// Historial real y auditoría — quién aprobó, cuándo, precio antes y
// después, resultado real de Mercado Libre. Nunca se borra ni se
// sobreescribe (al revés de promociones_candidatos): cada intento deja
// su propia fila.
export const promocionesAcciones = pgTable(
  "promociones_acciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaMlId: uuid("cuenta_ml_id").notNull().references(() => cuentasMl.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    tituloProducto: text("titulo_producto"),
    tipoPromocion: text("tipo_promocion").notNull(),
    promotionIdMl: text("promotion_id_ml"),
    accion: promocionAccionTipoEnum("accion").notNull(),
    precioAntes: numeric("precio_antes", { precision: 14, scale: 2 }),
    precioDespues: numeric("precio_despues", { precision: 14, scale: 2 }),
    estado: promocionAccionEstadoEnum("estado").notNull().default("pendiente"),
    aprobadoPor: uuid("aprobado_por").references(() => usuarios.id, { onDelete: "set null" }),
    aprobadoTs: timestamp("aprobado_ts", { withTimezone: true }),
    ejecutadoPor: uuid("ejecutado_por").references(() => usuarios.id, { onDelete: "set null" }),
    ejecutadoTs: timestamp("ejecutado_ts", { withTimezone: true }),
    // true = esto corrió en modo simulación (nunca tocó Mercado
    // Libre) — queda en el historial igual, para que se vea qué se
    // habría hecho, pero nunca se confunde con una ejecución real.
    modoSimulacion: boolean("modo_simulacion").notNull().default(false),
    // {ok, status, respuesta} — nunca el token, nunca más de 500
    // caracteres del cuerpo crudo de Mercado Libre (mismo criterio que
    // zilonix-os-web).
    resultadoMl: jsonb("resultado_ml"),
    error: text("error"),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cuentaDeLaEmpresa: foreignKey({
      name: "promociones_acciones_empresa_cuenta_fk",
      columns: [t.empresaId, t.cuentaMlId],
      foreignColumns: [cuentasMl.empresaId, cuentasMl.id],
    }).onDelete("cascade"),
    porEmpresaYEstado: index("promociones_acciones_empresa_estado_idx").on(t.empresaId, t.estado),
  })
);

// Rama feat-promociones, punto 6 — "Conexión de IA" por empresa,
// pensada como pieza COMÚN (lib/ia/) para que cualquier módulo futuro
// la use, no solo Promociones. Una sola fila por empresa por ahora
// (unique en empresaId) — si algún día hace falta más de una conexión
// por empresa, se agrega ahí, no se adivina acá. La API key se cifra
// con el MISMO mecanismo que los tokens de Mercado Libre
// (lib/cifrado.ts, AES-256-GCM versionado) — mismo criterio de
// CLAUDE.md ("tokens de marketplaces y credenciales... siempre
// cifrados"), reusado a propósito en vez de armar un segundo sistema
// de cifrado solo para esto.
export const proveedorIaEnum = pgEnum("proveedor_ia", ["anthropic", "openai", "google", "xai", "otro_compatible_openai"]);

export const iaConexiones = pgTable(
  "ia_conexiones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    proveedor: proveedorIaEnum("proveedor").notNull(),
    // Solo tiene sentido para "otro_compatible_openai" — cualquier
    // servidor que hable el mismo formato que la API de OpenAI.
    baseUrl: text("base_url"),
    modelo: text("modelo").notNull(),
    apiKeyCifrada: jsonb("api_key_cifrada").$type<TokenCifrado>().notNull(),
    creadoTs: timestamp("creado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoTs: timestamp("actualizado_ts", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPor: uuid("actualizado_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => ({
    unaPorEmpresa: unique("ia_conexiones_empresa_unica").on(t.empresaId),
  })
);
