CREATE TYPE "public"."estado_gasto" AS ENUM('pendiente', 'pagado');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categorias_gasto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "categorias_gasto_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "categorias_gasto_empresa_nombre_unico" UNIQUE("empresa_id","nombre"),
	CONSTRAINT "categorias_gasto_nombre_valido" CHECK ("categorias_gasto"."nombre" = btrim("categorias_gasto"."nombre") AND char_length("categorias_gasto"."nombre") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gastos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid,
	"cuenta_falabella_id" uuid,
	"categoria_id" uuid NOT NULL,
	"tercero_id" uuid,
	"beneficiario" text,
	"descripcion" text NOT NULL,
	"monto" numeric(14, 2) NOT NULL,
	"moneda" text NOT NULL,
	"fecha_gasto" date NOT NULL,
	"fecha_vencimiento" date,
	"estado" "estado_gasto" DEFAULT 'pendiente' NOT NULL,
	"fecha_pago" date,
	"medio_pago" text,
	"soporte" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "gastos_una_tienda" CHECK ("gastos"."cuenta_ml_id" is null or "gastos"."cuenta_falabella_id" is null),
	CONSTRAINT "gastos_tercero_o_beneficiario" CHECK ("gastos"."tercero_id" is not null or char_length(btrim(coalesce("gastos"."beneficiario", ''))) > 0),
	CONSTRAINT "gastos_descripcion_valida" CHECK (char_length(btrim("gastos"."descripcion")) between 1 and 300),
	CONSTRAINT "gastos_monto_positivo" CHECK ("gastos"."monto" > 0),
	CONSTRAINT "gastos_moneda_iso" CHECK ("gastos"."moneda" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gastos_pago_coherente" CHECK (("gastos"."estado" = 'pagado') = ("gastos"."fecha_pago" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_categoria_misma_empresa_fk" FOREIGN KEY ("empresa_id","categoria_id") REFERENCES "public"."categorias_gasto"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_cuenta_ml_misma_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_ml_id") REFERENCES "public"."cuentas_ml"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gastos" ADD CONSTRAINT "gastos_cuenta_falabella_misma_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_falabella_id") REFERENCES "public"."cuentas_falabella"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_empresa_fecha_idx" ON "gastos" USING btree ("empresa_id","fecha_gasto");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_empresa_estado_idx" ON "gastos" USING btree ("empresa_id","estado","fecha_vencimiento");