CREATE TYPE "public"."condicion_devolucion" AS ENUM('bueno', 'averiado');--> statement-breakpoint
CREATE TYPE "public"."estado_devolucion_inventario" AS ENUM('por_llegar', 'recibida', 'anulada');--> statement-breakpoint
ALTER TYPE "public"."origen_movimiento" ADD VALUE 'devolucion';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "devoluciones_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"cuenta_ml_id" uuid,
	"cuenta_falabella_id" uuid,
	"tienda_otra" text,
	"reclamo_id_ml" text,
	"linea_pedido" integer DEFAULT 0 NOT NULL,
	"pedido_id_externo" text,
	"estado_envio_ml" text,
	"sku_id" uuid,
	"producto" text NOT NULL,
	"cantidad" integer NOT NULL,
	"estado" "estado_devolucion_inventario" DEFAULT 'por_llegar' NOT NULL,
	"condicion" "condicion_devolucion",
	"bodega_id" uuid,
	"nota" text,
	"recibida_ts" timestamp with time zone,
	"recibida_por" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid,
	CONSTRAINT "devoluciones_inventario_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "devoluciones_inventario_cantidad_positiva" CHECK ("devoluciones_inventario"."cantidad" > 0),
	CONSTRAINT "devoluciones_inventario_producto_no_vacio" CHECK (btrim("devoluciones_inventario"."producto") <> '' and char_length("devoluciones_inventario"."producto") <= 300),
	CONSTRAINT "devoluciones_inventario_tienda_otra_largo" CHECK ("devoluciones_inventario"."tienda_otra" is null or char_length("devoluciones_inventario"."tienda_otra") between 1 and 60),
	CONSTRAINT "devoluciones_inventario_recibida_completa" CHECK (("devoluciones_inventario"."estado" = 'recibida') = ("devoluciones_inventario"."condicion" is not null and "devoluciones_inventario"."bodega_id" is not null and "devoluciones_inventario"."sku_id" is not null and "devoluciones_inventario"."recibida_ts" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_recibida_por_usuarios_id_fk" FOREIGN KEY ("recibida_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_bodega_misma_empresa_fk" FOREIGN KEY ("empresa_id","bodega_id") REFERENCES "public"."bodegas"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_cuenta_ml_misma_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_ml_id") REFERENCES "public"."cuentas_ml"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devoluciones_inventario" ADD CONSTRAINT "devoluciones_inventario_cuenta_falabella_misma_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_falabella_id") REFERENCES "public"."cuentas_falabella"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devoluciones_inventario_reclamo_unico" ON "devoluciones_inventario" USING btree ("empresa_id","reclamo_id_ml","linea_pedido") WHERE "devoluciones_inventario"."reclamo_id_ml" is not null;