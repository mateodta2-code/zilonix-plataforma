CREATE TABLE IF NOT EXISTS "publicidad_campanas_cambios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"campana_id_ml" text NOT NULL,
	"campo" text NOT NULL,
	"valor_anterior" numeric(14, 2),
	"valor_nuevo" numeric(14, 2),
	"detectado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_campanas_cambios" ADD CONSTRAINT "publicidad_campanas_cambios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicidad_campanas_cambios" ADD CONSTRAINT "publicidad_campanas_cambios_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publicidad_campanas_cambios_cuenta_ts" ON "publicidad_campanas_cambios" USING btree ("empresa_id","cuenta_ml_id","detectado_ts");