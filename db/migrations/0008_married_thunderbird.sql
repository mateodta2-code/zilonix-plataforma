CREATE TYPE "public"."logistic_type" AS ENUM('self_service', 'xd_drop_off', 'cross_docking', 'fulfillment', 'otro');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "despachos_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"shipment_id_externo" text NOT NULL,
	"logistic_type" "logistic_type",
	"status" text,
	"substatus" text,
	"imprimible" boolean DEFAULT false NOT NULL,
	"etiqueta_impresa_ts" timestamp with time zone,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_ml" ADD CONSTRAINT "despachos_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_ml" ADD CONSTRAINT "despachos_ml_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_ml" ADD CONSTRAINT "despachos_ml_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "despachos_ml_empresa_shipment_unico" ON "despachos_ml" USING btree ("empresa_id","shipment_id_externo");