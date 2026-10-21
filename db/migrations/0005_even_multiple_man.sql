CREATE TABLE IF NOT EXISTS "importaciones_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"pedidos_encontrados" integer DEFAULT 0 NOT NULL,
	"pedidos_importados" integer DEFAULT 0 NOT NULL,
	"publicaciones_encontradas" integer DEFAULT 0 NOT NULL,
	"publicaciones_importadas" integer DEFAULT 0 NOT NULL,
	"error" text,
	"iniciado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"completado_ts" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"pedido_id_externo" text NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"moneda" text NOT NULL,
	"estado" text NOT NULL,
	"importado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"publicacion_id_externo" text NOT NULL,
	"titulo" text NOT NULL,
	"precio" numeric(14, 2) NOT NULL,
	"stock" integer NOT NULL,
	"sku_id" uuid,
	"importado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "importaciones_ml" ADD CONSTRAINT "importaciones_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "importaciones_ml" ADD CONSTRAINT "importaciones_ml_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_empresa_pedido_externo_unico" ON "pedidos" USING btree ("empresa_id","pedido_id_externo");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publicaciones_empresa_publicacion_externa_unica" ON "publicaciones" USING btree ("empresa_id","publicacion_id_externo");