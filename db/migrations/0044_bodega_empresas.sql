DO $$ BEGIN
 CREATE TYPE "public"."estado_vinculo_bodega_3pl" AS ENUM('activa', 'pausada');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bodegas_3pl_empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"estado" "estado_vinculo_bodega_3pl" DEFAULT 'activa' NOT NULL,
	"creado_por" uuid NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recepcion_items_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recepcion_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"cantidad" integer NOT NULL,
	CONSTRAINT "recepcion_items_bodega_3pl_cantidad_positiva" CHECK ("recepcion_items_bodega_3pl"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recepciones_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"nota" text,
	"creado_por" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"cantidad" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_bodega_3pl_cantidad_no_negativa" CHECK ("stock_bodega_3pl"."cantidad" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bodegas_3pl_empresas" ADD CONSTRAINT "bodegas_3pl_empresas_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bodegas_3pl_empresas" ADD CONSTRAINT "bodegas_3pl_empresas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bodegas_3pl_empresas" ADD CONSTRAINT "bodegas_3pl_empresas_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepcion_items_bodega_3pl" ADD CONSTRAINT "recepcion_items_bodega_3pl_recepcion_id_recepciones_bodega_3pl_id_fk" FOREIGN KEY ("recepcion_id") REFERENCES "public"."recepciones_bodega_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones_bodega_3pl" ADD CONSTRAINT "recepciones_bodega_3pl_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones_bodega_3pl" ADD CONSTRAINT "recepciones_bodega_3pl_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recepciones_bodega_3pl" ADD CONSTRAINT "recepciones_bodega_3pl_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_bodega_3pl" ADD CONSTRAINT "stock_bodega_3pl_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_bodega_3pl" ADD CONSTRAINT "stock_bodega_3pl_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bodegas_3pl_empresas_bodega_empresa_unica" ON "bodegas_3pl_empresas" USING btree ("bodega_id","empresa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recepcion_items_bodega_3pl_recepcion_idx" ON "recepcion_items_bodega_3pl" USING btree ("recepcion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recepciones_bodega_3pl_bodega_idx" ON "recepciones_bodega_3pl" USING btree ("bodega_id","fecha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recepciones_bodega_3pl_empresa_idx" ON "recepciones_bodega_3pl" USING btree ("empresa_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_bodega_3pl_bodega_empresa_sku_unica" ON "stock_bodega_3pl" USING btree ("bodega_id","empresa_id","sku");