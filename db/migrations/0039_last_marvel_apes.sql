CREATE TYPE "public"."tipo_cuenta_disponible" AS ENUM('banco', 'billetera', 'efectivo');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cuentas_disponible" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_cuenta_disponible" NOT NULL,
	"entidad" text,
	"ultimos_4" text,
	"moneda" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid,
	CONSTRAINT "cuentas_disponible_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "cuentas_disponible_empresa_nombre_unico" UNIQUE("empresa_id","nombre"),
	CONSTRAINT "cuentas_disponible_nombre_no_vacio" CHECK (btrim("cuentas_disponible"."nombre") <> ''),
	CONSTRAINT "cuentas_disponible_ultimos_4_validos" CHECK ("cuentas_disponible"."ultimos_4" IS NULL OR "cuentas_disponible"."ultimos_4" ~ '^[0-9]{4}$'),
	CONSTRAINT "cuentas_disponible_moneda_iso" CHECK ("cuentas_disponible"."moneda" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saldos_disponible" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"saldo" numeric(16, 2) NOT NULL,
	"fecha_corte" date NOT NULL,
	"nota" text,
	"registrado_por" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cuentas_disponible" ADD CONSTRAINT "cuentas_disponible_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cuentas_disponible" ADD CONSTRAINT "cuentas_disponible_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saldos_disponible" ADD CONSTRAINT "saldos_disponible_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saldos_disponible" ADD CONSTRAINT "saldos_disponible_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saldos_disponible" ADD CONSTRAINT "saldos_disponible_cuenta_de_la_empresa" FOREIGN KEY ("empresa_id","cuenta_id") REFERENCES "public"."cuentas_disponible"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saldos_disponible_cuenta_fecha_idx" ON "saldos_disponible" USING btree ("empresa_id","cuenta_id","fecha_corte");