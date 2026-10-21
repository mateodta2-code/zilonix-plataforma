CREATE TABLE IF NOT EXISTS "kit_componentes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku_kit_id" uuid NOT NULL,
	"sku_componente_id" uuid NOT NULL,
	"cantidad" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"nombre_base" text,
	"es_kit" boolean DEFAULT false NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kit_componentes" ADD CONSTRAINT "kit_componentes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kit_componentes" ADD CONSTRAINT "kit_componentes_sku_kit_id_skus_id_fk" FOREIGN KEY ("sku_kit_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kit_componentes" ADD CONSTRAINT "kit_componentes_sku_componente_id_skus_id_fk" FOREIGN KEY ("sku_componente_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skus" ADD CONSTRAINT "skus_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kit_componentes_unico" ON "kit_componentes" USING btree ("sku_kit_id","sku_componente_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skus_empresa_codigo_unico" ON "skus" USING btree ("empresa_id","codigo");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
