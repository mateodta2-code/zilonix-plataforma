CREATE TYPE "public"."estado_costeo" AS ENUM('completo', 'parcial', 'sin_costo');--> statement-breakpoint
CREATE TYPE "public"."forma_entrega" AS ENUM('full_ml', 'flex', 'agencia', 'desconocida');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedido_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"publicacion_id" uuid,
	"item_id_externo" text NOT NULL,
	"sku_codigo" text,
	"sku_id" uuid,
	"cantidad" integer NOT NULL,
	"precio_unitario" numeric(14, 2) NOT NULL,
	"valor_linea" numeric(14, 2) NOT NULL,
	"comision_ml" numeric(14, 2),
	"flete_ml" numeric(14, 2),
	"costo_congelado" numeric(14, 2),
	"titulo" text NOT NULL,
	"imagen_url" text,
	"empaque_congelado" numeric(14, 2),
	"envio_congelado" numeric(14, 2),
	CONSTRAINT "pedido_items_pedido_linea_unica" UNIQUE("pedido_id","linea"),
	CONSTRAINT "pedido_items_linea_positiva" CHECK ("pedido_items"."linea" >= 1),
	CONSTRAINT "pedido_items_cantidad_positiva" CHECK ("pedido_items"."cantidad" > 0),
	CONSTRAINT "pedido_items_sku_normalizado" CHECK ("pedido_items"."sku_codigo" = upper(btrim("pedido_items"."sku_codigo")) AND "pedido_items"."sku_codigo" <> ''),
	CONSTRAINT "pedido_items_precio_unitario_no_negativo" CHECK ("pedido_items"."precio_unitario" >= 0),
	CONSTRAINT "pedido_items_valor_linea_no_negativo" CHECK ("pedido_items"."valor_linea" >= 0),
	CONSTRAINT "pedido_items_comision_ml_no_negativa" CHECK ("pedido_items"."comision_ml" >= 0),
	CONSTRAINT "pedido_items_flete_ml_no_negativo" CHECK ("pedido_items"."flete_ml" >= 0),
	CONSTRAINT "pedido_items_costo_no_negativo" CHECK ("pedido_items"."costo_congelado" >= 0),
	CONSTRAINT "pedido_items_empaque_no_negativo" CHECK ("pedido_items"."empaque_congelado" >= 0),
	CONSTRAINT "pedido_items_envio_no_negativo" CHECK ("pedido_items"."envio_congelado" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedidos_finanzas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"forma_entrega" "forma_entrega" DEFAULT 'desconocida' NOT NULL,
	"fecha_pago_aprobado" timestamp with time zone,
	"valor_venta" numeric(14, 2) NOT NULL,
	"reembolsos" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"comision_ml" numeric(14, 2),
	"flete_ml" numeric(14, 2),
	"empaque_congelado" numeric(14, 2),
	"envio_agencia_congelado" numeric(14, 2),
	"estado_costeo" "estado_costeo" DEFAULT 'sin_costo' NOT NULL,
	"congelado_ts" timestamp with time zone,
	"cancelada" boolean DEFAULT false NOT NULL,
	"sincronizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"shipment_id_externo" text,
	"pack_id_externo" text,
	"fecha_despacho" timestamp with time zone,
	"fecha_entrega" timestamp with time zone,
	CONSTRAINT "pedidos_finanzas_pedido_unico" UNIQUE("pedido_id"),
	CONSTRAINT "pedidos_finanzas_empresa_pedido_unico" UNIQUE("empresa_id","pedido_id"),
	CONSTRAINT "pedidos_finanzas_valor_venta_no_negativo" CHECK ("pedidos_finanzas"."valor_venta" >= 0),
	CONSTRAINT "pedidos_finanzas_reembolsos_no_negativos" CHECK ("pedidos_finanzas"."reembolsos" >= 0),
	CONSTRAINT "pedidos_finanzas_comision_ml_no_negativa" CHECK ("pedidos_finanzas"."comision_ml" >= 0),
	CONSTRAINT "pedidos_finanzas_flete_ml_no_negativo" CHECK ("pedidos_finanzas"."flete_ml" >= 0),
	CONSTRAINT "pedidos_finanzas_empaque_no_negativo" CHECK ("pedidos_finanzas"."empaque_congelado" >= 0),
	CONSTRAINT "pedidos_finanzas_envio_agencia_no_negativo" CHECK ("pedidos_finanzas"."envio_agencia_congelado" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ventas_correcciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"linea" integer,
	"campo" text NOT NULL,
	"valor_nuevo" numeric(14, 2) NOT NULL,
	"nota" text NOT NULL,
	"creado_por" uuid NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"anulada_ts" timestamp with time zone,
	CONSTRAINT "ventas_correcciones_campo_valido" CHECK ("ventas_correcciones"."campo" IN ('costo_producto', 'empaque', 'envio_agencia', 'comision_ml', 'flete_ml')),
	CONSTRAINT "ventas_correcciones_valor_no_negativo" CHECK ("ventas_correcciones"."valor_nuevo" >= 0),
	CONSTRAINT "ventas_correcciones_nota_con_texto" CHECK (btrim("ventas_correcciones"."nota") <> '')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_publicacion_id_publicaciones_id_fk" FOREIGN KEY ("publicacion_id") REFERENCES "public"."publicaciones"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_venta_misma_empresa_fk" FOREIGN KEY ("empresa_id","pedido_id") REFERENCES "public"."pedidos_finanzas"("empresa_id","pedido_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_finanzas" ADD CONSTRAINT "pedidos_finanzas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_finanzas" ADD CONSTRAINT "pedidos_finanzas_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_finanzas" ADD CONSTRAINT "pedidos_finanzas_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_correcciones" ADD CONSTRAINT "ventas_correcciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_correcciones" ADD CONSTRAINT "ventas_correcciones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_correcciones" ADD CONSTRAINT "ventas_correcciones_venta_misma_empresa_fk" FOREIGN KEY ("empresa_id","pedido_id") REFERENCES "public"."pedidos_finanzas"("empresa_id","pedido_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ventas_correcciones" ADD CONSTRAINT "ventas_correcciones_linea_fk" FOREIGN KEY ("pedido_id","linea") REFERENCES "public"."pedido_items"("pedido_id","linea") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pedidos_finanzas_empresa_shipment_idx" ON "pedidos_finanzas" USING btree ("empresa_id","shipment_id_externo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pedidos_finanzas_empresa_fecha_despacho_idx" ON "pedidos_finanzas" USING btree ("empresa_id","fecha_despacho");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ventas_correcciones_una_activa" ON "ventas_correcciones" USING btree ("pedido_id",coalesce("linea", 0),"campo") WHERE "ventas_correcciones"."anulada_ts" IS NULL;