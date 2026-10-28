CREATE TYPE "public"."tipo_titular" AS ENUM('persona', 'sociedad');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "configuracion_finanzas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"flex_valor" numeric(14, 2),
	"iva_publicidad" numeric(5, 2),
	"plazo_vencimiento_dias" integer DEFAULT 3 NOT NULL,
	"aviso_dias_antes" integer,
	"aviso_correo_activo" boolean,
	"aviso_whatsapp_activo" boolean,
	"aviso_correo_destino" text,
	"aviso_whatsapp_destino" text,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_por" uuid,
	CONSTRAINT "configuracion_finanzas_empresa_unica" UNIQUE("empresa_id"),
	CONSTRAINT "configuracion_finanzas_plazo_no_negativo" CHECK ("configuracion_finanzas"."plazo_vencimiento_dias" >= 0),
	CONSTRAINT "configuracion_finanzas_iva_rango" CHECK ("configuracion_finanzas"."iva_publicidad" IS NULL OR ("configuracion_finanzas"."iva_publicidad" >= 0 AND "configuracion_finanzas"."iva_publicidad" <= 100))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metas_mensuales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"mes" date NOT NULL,
	"meta_utilidad" numeric(14, 2) NOT NULL,
	"moneda" text DEFAULT 'COP' NOT NULL,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_por" uuid,
	CONSTRAINT "metas_mensuales_empresa_mes_moneda_unica" UNIQUE("empresa_id","mes","moneda"),
	CONSTRAINT "metas_mensuales_dia_uno" CHECK (extract(day from "metas_mensuales"."mes") = 1),
	CONSTRAINT "metas_mensuales_utilidad_no_negativa" CHECK ("metas_mensuales"."meta_utilidad" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "titulares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" "tipo_titular" NOT NULL,
	"nombre" text NOT NULL,
	"documento" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "titulares_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "titulares_empresa_documento_unico" UNIQUE("empresa_id","documento")
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD COLUMN "entidad_id" text;--> statement-breakpoint
ALTER TABLE "auditoria" ADD COLUMN "valor_anterior" text;--> statement-breakpoint
ALTER TABLE "auditoria" ADD COLUMN "valor_nuevo" text;--> statement-breakpoint
ALTER TABLE "cuentas_ml" ADD COLUMN "titular_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "configuracion_finanzas" ADD CONSTRAINT "configuracion_finanzas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "configuracion_finanzas" ADD CONSTRAINT "configuracion_finanzas_actualizada_por_usuarios_id_fk" FOREIGN KEY ("actualizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "metas_mensuales" ADD CONSTRAINT "metas_mensuales_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "metas_mensuales" ADD CONSTRAINT "metas_mensuales_actualizada_por_usuarios_id_fk" FOREIGN KEY ("actualizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "titulares" ADD CONSTRAINT "titulares_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cuentas_ml" ADD CONSTRAINT "cuentas_ml_empresa_titular_fk" FOREIGN KEY ("empresa_id","titular_id") REFERENCES "public"."titulares"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
