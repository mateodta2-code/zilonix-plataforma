CREATE TABLE IF NOT EXISTS "cuentas_falabella" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"api_key_cifrada" jsonb NOT NULL,
	"seller_id" text NOT NULL,
	"nickname" text NOT NULL,
	"desconectada_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedidos_falabella" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_falabella_id" uuid NOT NULL,
	"pedido_id_externo" text NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"moneda" text NOT NULL,
	"estado" text NOT NULL,
	"items" jsonb NOT NULL,
	"importado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cuentas_falabella" ADD CONSTRAINT "cuentas_falabella_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_falabella" ADD CONSTRAINT "pedidos_falabella_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_falabella" ADD CONSTRAINT "pedidos_falabella_cuenta_falabella_id_cuentas_falabella_id_fk" FOREIGN KEY ("cuenta_falabella_id") REFERENCES "public"."cuentas_falabella"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cuentas_falabella_user_id_unica" ON "cuentas_falabella" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_falabella_empresa_pedido_externo_unico" ON "pedidos_falabella" USING btree ("empresa_id","pedido_id_externo");