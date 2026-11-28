CREATE TABLE IF NOT EXISTS "proyeccion_configuracion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cobertura_dias" integer DEFAULT 30 NOT NULL,
	"colchon_porcentaje" integer DEFAULT 20 NOT NULL,
	"ventana_dias" integer DEFAULT 14 NOT NULL,
	"lead_nacional_dias" integer DEFAULT 7 NOT NULL,
	"lead_plataforma_dias" integer DEFAULT 15 NOT NULL,
	"lead_avion_dias" integer DEFAULT 25 NOT NULL,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_por" uuid,
	CONSTRAINT "proyeccion_configuracion_empresa_unica" UNIQUE("empresa_id"),
	CONSTRAINT "proyeccion_configuracion_cobertura_valida" CHECK ("proyeccion_configuracion"."cobertura_dias" between 1 and 365),
	CONSTRAINT "proyeccion_configuracion_colchon_valido" CHECK ("proyeccion_configuracion"."colchon_porcentaje" between 0 and 200),
	CONSTRAINT "proyeccion_configuracion_ventana_valida" CHECK ("proyeccion_configuracion"."ventana_dias" in (3, 7, 14, 20, 30)),
	CONSTRAINT "proyeccion_configuracion_leads_validos" CHECK ("proyeccion_configuracion"."lead_nacional_dias" between 0 and 365 and "proyeccion_configuracion"."lead_plataforma_dias" between 0 and 365 and "proyeccion_configuracion"."lead_avion_dias" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proyeccion_sku" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"ruta" text DEFAULT 'plataforma' NOT NULL,
	"lead_time_dias" integer,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proyeccion_sku_empresa_sku_unico" UNIQUE("empresa_id","sku_id"),
	CONSTRAINT "proyeccion_sku_ruta_valida" CHECK ("proyeccion_sku"."ruta" in ('nacional', 'plataforma', 'avion')),
	CONSTRAINT "proyeccion_sku_lead_valido" CHECK ("proyeccion_sku"."lead_time_dias" is null or "proyeccion_sku"."lead_time_dias" between 0 and 365)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proyeccion_configuracion" ADD CONSTRAINT "proyeccion_configuracion_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proyeccion_configuracion" ADD CONSTRAINT "proyeccion_configuracion_actualizada_por_usuarios_id_fk" FOREIGN KEY ("actualizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proyeccion_sku" ADD CONSTRAINT "proyeccion_sku_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proyeccion_sku" ADD CONSTRAINT "proyeccion_sku_sku_misma_empresa_fk" FOREIGN KEY ("empresa_id","sku_id") REFERENCES "public"."skus"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
