DO $$ BEGIN
 CREATE TYPE "public"."estado_despacho_bodega_3pl" AS ENUM('pendiente', 'preparado');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "despacho_items_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"despacho_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"cantidad" integer NOT NULL,
	CONSTRAINT "despacho_items_bodega_3pl_cantidad_positiva" CHECK ("despacho_items_bodega_3pl"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "despachos_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"numero_pedido" text NOT NULL,
	"tipo_envio" text,
	"estado" "estado_despacho_bodega_3pl" DEFAULT 'pendiente' NOT NULL,
	"preparado_ts" timestamp with time zone,
	"preparado_por" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "despachos_bodega_3pl_empresa_id_unica" UNIQUE("empresa_id","id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despacho_items_bodega_3pl" ADD CONSTRAINT "despacho_items_bodega_3pl_despacho_id_despachos_bodega_3pl_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despachos_bodega_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despacho_items_bodega_3pl" ADD CONSTRAINT "despacho_items_bodega_3pl_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despacho_items_bodega_3pl" ADD CONSTRAINT "despacho_items_bodega_3pl_despacho_misma_empresa_fk" FOREIGN KEY ("empresa_id","despacho_id") REFERENCES "public"."despachos_bodega_3pl"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_bodega_3pl" ADD CONSTRAINT "despachos_bodega_3pl_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_bodega_3pl" ADD CONSTRAINT "despachos_bodega_3pl_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_bodega_3pl" ADD CONSTRAINT "despachos_bodega_3pl_preparado_por_usuarios_id_fk" FOREIGN KEY ("preparado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_bodega_3pl" ADD CONSTRAINT "despachos_bodega_3pl_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_bodega_3pl" ADD CONSTRAINT "despachos_bodega_3pl_pedido_misma_empresa_fk" FOREIGN KEY ("empresa_id","pedido_id") REFERENCES "public"."pedidos"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "despacho_items_bodega_3pl_despacho_idx" ON "despacho_items_bodega_3pl" USING btree ("despacho_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "despachos_bodega_3pl_empresa_pedido_unico" ON "despachos_bodega_3pl" USING btree ("empresa_id","pedido_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "despachos_bodega_3pl_bodega_idx" ON "despachos_bodega_3pl" USING btree ("bodega_id","estado","creado_ts");