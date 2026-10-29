ALTER TABLE "cuentas_ml" ADD CONSTRAINT "cuentas_ml_empresa_id_unica" UNIQUE("empresa_id","id");--> statement-breakpoint
CREATE TYPE "public"."promocion_accion_estado" AS ENUM('pendiente', 'aceptada', 'rechazada', 'ejecutada', 'fallida');--> statement-breakpoint
CREATE TYPE "public"."promocion_accion_tipo" AS ENUM('participar', 'modificar', 'salir');--> statement-breakpoint
CREATE TYPE "public"."proveedor_ia" AS ENUM('anthropic', 'openai', 'google', 'xai', 'otro_compatible_openai');--> statement-breakpoint
ALTER TYPE "public"."accion" ADD VALUE 'aprobar';--> statement-breakpoint
ALTER TYPE "public"."accion" ADD VALUE 'ejecutar';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ia_conexiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"proveedor" "proveedor_ia" NOT NULL,
	"base_url" text,
	"modelo" text NOT NULL,
	"api_key_cifrada" jsonb NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "ia_conexiones_empresa_unica" UNIQUE("empresa_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promociones_acciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"titulo_producto" text,
	"tipo_promocion" text NOT NULL,
	"promotion_id_ml" text,
	"accion" "promocion_accion_tipo" NOT NULL,
	"precio_antes" numeric(14, 2),
	"precio_despues" numeric(14, 2),
	"estado" "promocion_accion_estado" DEFAULT 'pendiente' NOT NULL,
	"aprobado_por" uuid,
	"aprobado_ts" timestamp with time zone,
	"ejecutado_por" uuid,
	"ejecutado_ts" timestamp with time zone,
	"modo_simulacion" boolean DEFAULT false NOT NULL,
	"resultado_ml" jsonb,
	"error" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promociones_candidatos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"sku_codigo" text,
	"titulo_producto" text,
	"thumbnail" text,
	"tiene_variantes" boolean DEFAULT false NOT NULL,
	"tipo_promocion" text NOT NULL,
	"promotion_id_ml" text,
	"estado_ml" text NOT NULL,
	"es_compartida" boolean DEFAULT false NOT NULL,
	"solo_en_ml" boolean DEFAULT false NOT NULL,
	"precio_original" numeric(14, 2),
	"precio_actual" numeric(14, 2),
	"precio_minimo" numeric(14, 2),
	"precio_sugerido" numeric(14, 2),
	"max_discounted_price" numeric(14, 2),
	"ganancia_estimada" numeric(14, 2),
	"cumple_reglas" boolean DEFAULT false NOT NULL,
	"motivo_revisar_manual" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promociones_candidatos_unico" UNIQUE("cuenta_ml_id","item_id","tipo_promocion")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promociones_reglas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"descuento_maximo_pct" integer DEFAULT 20 NOT NULL,
	"participar_compartidas" boolean DEFAULT false NOT NULL,
	"igualar_al_piso" boolean DEFAULT true NOT NULL,
	"busqueda_automatica_hora" text,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "promociones_reglas_cuenta_unica" UNIQUE("cuenta_ml_id"),
	CONSTRAINT "promociones_reglas_descuento_rango" CHECK ("promociones_reglas"."descuento_maximo_pct" > 0 AND "promociones_reglas"."descuento_maximo_pct" <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexiones" ADD CONSTRAINT "ia_conexiones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexiones" ADD CONSTRAINT "ia_conexiones_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_acciones" ADD CONSTRAINT "promociones_acciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_acciones" ADD CONSTRAINT "promociones_acciones_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_acciones" ADD CONSTRAINT "promociones_acciones_aprobado_por_usuarios_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_acciones" ADD CONSTRAINT "promociones_acciones_ejecutado_por_usuarios_id_fk" FOREIGN KEY ("ejecutado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_acciones" ADD CONSTRAINT "promociones_acciones_empresa_cuenta_fk" FOREIGN KEY ("empresa_id","cuenta_ml_id") REFERENCES "public"."cuentas_ml"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_candidatos" ADD CONSTRAINT "promociones_candidatos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_candidatos" ADD CONSTRAINT "promociones_candidatos_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_candidatos" ADD CONSTRAINT "promociones_candidatos_empresa_cuenta_fk" FOREIGN KEY ("empresa_id","cuenta_ml_id") REFERENCES "public"."cuentas_ml"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_empresa_cuenta_fk" FOREIGN KEY ("empresa_id","cuenta_ml_id") REFERENCES "public"."cuentas_ml"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promociones_acciones_empresa_estado_idx" ON "promociones_acciones" USING btree ("empresa_id","estado");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promociones_candidatos_empresa_idx" ON "promociones_candidatos" USING btree ("empresa_id");