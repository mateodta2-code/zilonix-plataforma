CREATE TYPE "public"."publicidad_estado_acceso" AS ENUM('ok', 'sin_product_ads', 'sin_permiso_app');--> statement-breakpoint
CREATE TYPE "public"."publicidad_estado_sync" AS ENUM('en_curso', 'ok', 'parcial', 'error');--> statement-breakpoint
CREATE TYPE "public"."publicidad_nivel_metrica" AS ENUM('cuenta', 'campana', 'ad_group', 'anuncio');--> statement-breakpoint
CREATE TYPE "public"."publicidad_origen_sync" AS ENUM('programada', 'manual');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_anunciantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"advertiser_id" text,
	"site_id" text,
	"nombre" text,
	"estado_acceso" "publicidad_estado_acceso" NOT NULL,
	"verificado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_anuncios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"ad_group_id" text NOT NULL,
	"tipo_ad_group" text,
	"ad_group_externo_id" text,
	"campana_id_ml" text,
	"item_id" text NOT NULL,
	"titulo" text,
	"permalink" text,
	"estado" text,
	"precio" numeric(14, 2),
	"logistic_type" text,
	"listing_type_id" text,
	"sincronizado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_campanas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"campana_id_ml" text NOT NULL,
	"nombre" text,
	"estado" text,
	"estrategia" text,
	"presupuesto" numeric(14, 2),
	"presupuesto_diario" numeric(14, 2),
	"presupuesto_automatico" boolean,
	"roas_objetivo" numeric(6, 2),
	"acos_objetivo" numeric(10, 4),
	"acos_objetivo_calculado" boolean DEFAULT false NOT NULL,
	"moneda" text,
	"creada_ml_ts" timestamp with time zone,
	"actualizada_ml_ts" timestamp with time zone,
	"sincronizada_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_costos_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"fecha" date NOT NULL,
	"sku_codigo" text,
	"category_id" text,
	"precio_venta_vigente" numeric(14, 2),
	"precio_regular" numeric(14, 2),
	"comision_ml" numeric(14, 2),
	"comision_detalle" jsonb,
	"envio_vendedor_estimado" numeric(14, 2),
	"comprador_paga_envio" boolean,
	"logistic_type" text,
	"shipping_mode" text,
	"listing_type_id" text,
	"consultado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_metricas_diarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"nivel" "publicidad_nivel_metrica" NOT NULL,
	"entidad_id_ml" text NOT NULL,
	"fecha" date NOT NULL,
	"clicks" integer,
	"impresiones" integer,
	"costo" numeric(14, 2),
	"monto_directo" numeric(14, 2),
	"monto_indirecto" numeric(14, 2),
	"monto_total" numeric(14, 2),
	"unidades_directas" integer,
	"unidades_indirectas" integer,
	"unidades_total" integer,
	"ventas_publicidad" integer,
	"ventas_organicas_cant" integer,
	"ventas_organicas_monto" numeric(14, 2),
	"acos" numeric(10, 4),
	"roas" numeric(10, 4),
	"tacos" numeric(10, 4),
	"sov" numeric(10, 4),
	"cvr" numeric(10, 4),
	"ctr" numeric(10, 4),
	"cpc" numeric(14, 2),
	"sincronizada_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicidad_sincronizaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"origen" "publicidad_origen_sync" NOT NULL,
	"solicitada_por" uuid,
	"rango_desde" date,
	"rango_hasta" date,
	"estado" "publicidad_estado_sync" NOT NULL,
	"llamadas" integer DEFAULT 0 NOT NULL,
	"error" text,
	"iniciada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"terminada_ts" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_anunciantes" ADD CONSTRAINT "publicidad_anunciantes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_anunciantes" ADD CONSTRAINT "publicidad_anunciantes_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_anuncios" ADD CONSTRAINT "publicidad_anuncios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_anuncios" ADD CONSTRAINT "publicidad_anuncios_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_campanas" ADD CONSTRAINT "publicidad_campanas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_campanas" ADD CONSTRAINT "publicidad_campanas_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_costos_item" ADD CONSTRAINT "publicidad_costos_item_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_costos_item" ADD CONSTRAINT "publicidad_costos_item_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_metricas_diarias" ADD CONSTRAINT "publicidad_metricas_diarias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_metricas_diarias" ADD CONSTRAINT "publicidad_metricas_diarias_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_sincronizaciones" ADD CONSTRAINT "publicidad_sincronizaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_sincronizaciones" ADD CONSTRAINT "publicidad_sincronizaciones_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_sincronizaciones" ADD CONSTRAINT "publicidad_sincronizaciones_solicitada_por_usuarios_id_fk" FOREIGN KEY ("solicitada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicidad_anunciantes_cuenta_unica" ON "publicidad_anunciantes" USING btree ("cuenta_ml_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicidad_anuncios_cuenta_grupo_item_unico" ON "publicidad_anuncios" USING btree ("cuenta_ml_id","ad_group_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicidad_campanas_cuenta_campana_unica" ON "publicidad_campanas" USING btree ("cuenta_ml_id","campana_id_ml");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicidad_costos_item_unico" ON "publicidad_costos_item" USING btree ("cuenta_ml_id","item_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicidad_metricas_diarias_unica" ON "publicidad_metricas_diarias" USING btree ("cuenta_ml_id","nivel","entidad_id_ml","fecha");