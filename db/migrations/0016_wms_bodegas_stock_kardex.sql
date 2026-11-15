CREATE TYPE "public"."estado_alerta_ultima_unidad" AS ENUM('pendiente', 'aplicada', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."estado_orden_compra" AS ENUM('abierta', 'parcial', 'recibida', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."origen_movimiento" AS ENUM('manual', 'recepcion', 'pedido_ml', 'traslado');--> statement-breakpoint
CREATE TYPE "public"."regla_ultima_unidad" AS ENUM('preguntar', 'quitar_promos', 'vender_sin_promo');--> statement-breakpoint
CREATE TYPE "public"."tipo_bodega" AS ENUM('propia', 'fulfillment_ml', 'tercero');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento" AS ENUM('entrada', 'salida', 'ajuste', 'traslado', 'reserva', 'liberacion', 'confirmacion');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alertas_ultima_unidad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"disponible_al_crear" integer NOT NULL,
	"regla" "regla_ultima_unidad" NOT NULL,
	"estado" "estado_alerta_ultima_unidad" DEFAULT 'pendiente' NOT NULL,
	"creada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelta_ts" timestamp with time zone,
	"resuelta_por" uuid,
	CONSTRAINT "alertas_ultima_unidad_resuelta_con_fecha" CHECK (("alertas_ultima_unidad"."estado" = 'pendiente') = ("alertas_ultima_unidad"."resuelta_ts" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bodegas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_bodega" DEFAULT 'propia' NOT NULL,
	"es_principal" boolean DEFAULT false NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"suma_al_publicado" boolean DEFAULT true NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bodegas_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "bodegas_empresa_nombre_unico" UNIQUE("empresa_id","nombre"),
	CONSTRAINT "bodegas_nombre_no_vacio" CHECK (btrim("bodegas"."nombre") <> '')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "configuracion_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"regla_ultima_unidad" "regla_ultima_unidad" DEFAULT 'preguntar' NOT NULL,
	"umbral_ultima_unidad" integer DEFAULT 1 NOT NULL,
	"buffer_ml" integer DEFAULT 0 NOT NULL,
	"sync_ml_activo" boolean DEFAULT false NOT NULL,
	"reserva_pedidos_desde_ts" timestamp with time zone,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_por" uuid,
	CONSTRAINT "configuracion_inventario_empresa_unica" UNIQUE("empresa_id"),
	CONSTRAINT "configuracion_inventario_umbral_no_negativo" CHECK ("configuracion_inventario"."umbral_ultima_unidad" >= 0),
	CONSTRAINT "configuracion_inventario_buffer_no_negativo" CHECK ("configuracion_inventario"."buffer_ml" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kardex_movimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"grupo_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"clave_idempotencia" text NOT NULL,
	"tipo" "tipo_movimiento" NOT NULL,
	"origen" "origen_movimiento" NOT NULL,
	"bodega_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"delta_disponible" integer NOT NULL,
	"delta_reservado" integer NOT NULL,
	"delta_en_transito" integer DEFAULT 0 NOT NULL,
	"saldo_disponible" integer NOT NULL,
	"saldo_reservado" integer NOT NULL,
	"saldo_en_transito" integer DEFAULT 0 NOT NULL,
	"referencia_id" text,
	"actor_tipo" "actor_tipo" NOT NULL,
	"usuario_id" uuid,
	"nota" text,
	CONSTRAINT "kardex_movimientos_clave_linea_unica" UNIQUE("empresa_id","clave_idempotencia","linea"),
	CONSTRAINT "kardex_movimientos_linea_positiva" CHECK ("kardex_movimientos"."linea" >= 1),
	CONSTRAINT "kardex_movimientos_clave_no_vacia" CHECK (btrim("kardex_movimientos"."clave_idempotencia") <> ''),
	CONSTRAINT "kardex_movimientos_mueve_algo" CHECK ("kardex_movimientos"."delta_disponible" <> 0 OR "kardex_movimientos"."delta_reservado" <> 0 OR "kardex_movimientos"."delta_en_transito" <> 0),
	CONSTRAINT "kardex_movimientos_saldos_no_negativos" CHECK ("kardex_movimientos"."saldo_disponible" >= 0 AND "kardex_movimientos"."saldo_reservado" >= 0 AND "kardex_movimientos"."saldo_en_transito" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orden_compra_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"orden_compra_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"cantidad_pedida" integer NOT NULL,
	"cantidad_recibida" integer DEFAULT 0 NOT NULL,
	"costo_unitario" numeric(14, 2),
	CONSTRAINT "orden_compra_items_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "orden_compra_items_orden_sku_unico" UNIQUE("orden_compra_id","sku_id"),
	CONSTRAINT "orden_compra_items_pedida_positiva" CHECK ("orden_compra_items"."cantidad_pedida" > 0),
	CONSTRAINT "orden_compra_items_recibida_no_negativa" CHECK ("orden_compra_items"."cantidad_recibida" >= 0),
	CONSTRAINT "orden_compra_items_costo_no_negativo" CHECK ("orden_compra_items"."costo_unitario" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ordenes_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"tercero_id" uuid,
	"bodega_destino_id" uuid NOT NULL,
	"estado" "estado_orden_compra" DEFAULT 'abierta' NOT NULL,
	"nota" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordenes_compra_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "ordenes_compra_empresa_numero_unico" UNIQUE("empresa_id","numero"),
	CONSTRAINT "ordenes_compra_numero_positivo" CHECK ("ordenes_compra"."numero" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recepcion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"recepcion_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"orden_compra_item_id" uuid,
	"cantidad" integer NOT NULL,
	CONSTRAINT "recepcion_items_cantidad_positiva" CHECK ("recepcion_items"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recepciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"orden_compra_id" uuid,
	"bodega_id" uuid NOT NULL,
	"nota" text,
	"recibido_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"recibido_por" uuid,
	CONSTRAINT "recepciones_empresa_id_unica" UNIQUE("empresa_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_bodega" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"bodega_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"disponible" integer DEFAULT 0 NOT NULL,
	"reservado" integer DEFAULT 0 NOT NULL,
	"en_transito" integer DEFAULT 0 NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_bodega_sku_bodega_unico" UNIQUE("empresa_id","bodega_id","sku_id"),
	CONSTRAINT "stock_bodega_disponible_no_negativo" CHECK ("stock_bodega"."disponible" >= 0),
	CONSTRAINT "stock_bodega_reservado_no_negativo" CHECK ("stock_bodega"."reservado" >= 0),
	CONSTRAINT "stock_bodega_en_transito_no_negativo" CHECK ("stock_bodega"."en_transito" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_stock_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"pendiente_desde_ts" timestamp with time zone,
	"ultimo_envio_ts" timestamp with time zone,
	"ultima_cantidad_enviada" integer,
	"ultimo_resultado" text,
	CONSTRAINT "sync_stock_ml_empresa_sku_unico" UNIQUE("empresa_id","sku_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alertas_ultima_unidad" ADD CONSTRAINT "alertas_ultima_unidad_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alertas_ultima_unidad" ADD CONSTRAINT "alertas_ultima_unidad_resuelta_por_usuarios_id_fk" FOREIGN KEY ("resuelta_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alertas_ultima_unidad" ADD CONSTRAINT "alertas_ultima_unidad_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bodegas" ADD CONSTRAINT "bodegas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "configuracion_inventario" ADD CONSTRAINT "configuracion_inventario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "configuracion_inventario" ADD CONSTRAINT "configuracion_inventario_actualizada_por_usuarios_id_fk" FOREIGN KEY ("actualizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kardex_movimientos" ADD CONSTRAINT "kardex_movimientos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kardex_movimientos" ADD CONSTRAINT "kardex_movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kardex_movimientos" ADD CONSTRAINT "kardex_movimientos_bodega_misma_empresa_fk" FOREIGN KEY ("empresa_id","bodega_id") REFERENCES "public"."bodegas"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kardex_movimientos" ADD CONSTRAINT "kardex_movimientos_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_orden_misma_empresa_fk" FOREIGN KEY ("empresa_id","orden_compra_id") REFERENCES "public"."ordenes_compra"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_bodega_misma_empresa_fk" FOREIGN KEY ("empresa_id","bodega_destino_id") REFERENCES "public"."bodegas"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_recepcion_misma_empresa_fk" FOREIGN KEY ("empresa_id","recepcion_id") REFERENCES "public"."recepciones"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_linea_oc_misma_empresa_fk" FOREIGN KEY ("empresa_id","orden_compra_item_id") REFERENCES "public"."orden_compra_items"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_recibido_por_usuarios_id_fk" FOREIGN KEY ("recibido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_orden_misma_empresa_fk" FOREIGN KEY ("empresa_id","orden_compra_id") REFERENCES "public"."ordenes_compra"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_bodega_misma_empresa_fk" FOREIGN KEY ("empresa_id","bodega_id") REFERENCES "public"."bodegas"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_bodega" ADD CONSTRAINT "stock_bodega_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_bodega" ADD CONSTRAINT "stock_bodega_bodega_misma_empresa_fk" FOREIGN KEY ("empresa_id","bodega_id") REFERENCES "public"."bodegas"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_bodega" ADD CONSTRAINT "stock_bodega_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_stock_ml" ADD CONSTRAINT "sync_stock_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_stock_ml" ADD CONSTRAINT "sync_stock_ml_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alertas_ultima_unidad_pendiente_unica" ON "alertas_ultima_unidad" USING btree ("empresa_id","sku_id") WHERE "alertas_ultima_unidad"."estado" = 'pendiente';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bodegas_principal_unica" ON "bodegas" USING btree ("empresa_id") WHERE "bodegas"."es_principal";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kardex_movimientos_empresa_sku_ts_idx" ON "kardex_movimientos" USING btree ("empresa_id","sku_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kardex_movimientos_empresa_bodega_ts_idx" ON "kardex_movimientos" USING btree ("empresa_id","bodega_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kardex_movimientos_empresa_referencia_idx" ON "kardex_movimientos" USING btree ("empresa_id","referencia_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_bodega_empresa_sku_idx" ON "stock_bodega" USING btree ("empresa_id","sku_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_stock_ml_empresa_pendiente_idx" ON "sync_stock_ml" USING btree ("empresa_id","pendiente_desde_ts");