CREATE TYPE "public"."condicion_pago" AS ENUM('inmediato', 'cuenta_cobro', 'anticipado_full_ml');--> statement-breakpoint
CREATE TYPE "public"."fuente_costo" AS ENUM('manual', 'archivo');--> statement-breakpoint
CREATE TYPE "public"."periodicidad_pago" AS ENUM('semanal', 'quincenal', 'mensual');--> statement-breakpoint
CREATE TYPE "public"."tipo_tercero" AS ENUM('proveedor_producto', 'empaque', 'agencia', 'flex', 'otro');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costos_sku" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sku_codigo" text NOT NULL,
	"nombre_producto" text,
	"costo" numeric(14, 2),
	"empaque" numeric(14, 2),
	"envio_agencia" numeric(14, 2),
	"precio_minimo_unidad" numeric(14, 2),
	"precio_minimo_combo_x2" numeric(14, 2),
	"precio_minimo_combo_x3" numeric(14, 2),
	"precio_venta" numeric(14, 2),
	"tercero_id" uuid,
	"fuente" "fuente_costo" DEFAULT 'manual' NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "costos_sku_empresa_sku_unico" UNIQUE("empresa_id","sku_codigo"),
	CONSTRAINT "costos_sku_sku_normalizado" CHECK ("costos_sku"."sku_codigo" = upper(btrim("costos_sku"."sku_codigo")) AND "costos_sku"."sku_codigo" <> ''),
	CONSTRAINT "costos_sku_costo_no_negativo" CHECK ("costos_sku"."costo" >= 0),
	CONSTRAINT "costos_sku_empaque_no_negativo" CHECK ("costos_sku"."empaque" >= 0),
	CONSTRAINT "costos_sku_envio_agencia_no_negativo" CHECK ("costos_sku"."envio_agencia" >= 0),
	CONSTRAINT "costos_sku_precio_venta_no_negativo" CHECK ("costos_sku"."precio_venta" >= 0),
	CONSTRAINT "costos_sku_precio_minimo_unidad_positivo" CHECK ("costos_sku"."precio_minimo_unidad" > 0),
	CONSTRAINT "costos_sku_precio_minimo_combo_x2_positivo" CHECK ("costos_sku"."precio_minimo_combo_x2" > 0),
	CONSTRAINT "costos_sku_precio_minimo_combo_x3_positivo" CHECK ("costos_sku"."precio_minimo_combo_x3" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terceros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_tercero" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"empaque" numeric(14, 2),
	"condicion_pago" "condicion_pago" NOT NULL,
	"periodicidad" "periodicidad_pago",
	"plazo_dias" integer,
	"predeterminado_envio_agencia" boolean DEFAULT false NOT NULL,
	"predeterminado_empaque" boolean DEFAULT false NOT NULL,
	"predeterminado_flex" boolean DEFAULT false NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" uuid,
	CONSTRAINT "terceros_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "terceros_empresa_nombre_unico" UNIQUE("empresa_id","nombre"),
	CONSTRAINT "terceros_empaque_no_negativo" CHECK ("terceros"."empaque" >= 0),
	CONSTRAINT "terceros_plazo_no_negativo" CHECK ("terceros"."plazo_dias" >= 0),
	CONSTRAINT "terceros_cuenta_cobro_con_periodicidad" CHECK ("terceros"."condicion_pago" <> 'cuenta_cobro' OR "terceros"."periodicidad" IS NOT NULL)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "costos_sku" ADD CONSTRAINT "costos_sku_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "costos_sku" ADD CONSTRAINT "costos_sku_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "costos_sku" ADD CONSTRAINT "costos_sku_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terceros" ADD CONSTRAINT "terceros_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terceros" ADD CONSTRAINT "terceros_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terceros_habitual_envio_agencia_unico" ON "terceros" USING btree ("empresa_id") WHERE "terceros"."predeterminado_envio_agencia";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terceros_habitual_empaque_unico" ON "terceros" USING btree ("empresa_id") WHERE "terceros"."predeterminado_empaque";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terceros_habitual_flex_unico" ON "terceros" USING btree ("empresa_id") WHERE "terceros"."predeterminado_flex";