CREATE TABLE IF NOT EXISTS "cuentas_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id_externa" text NOT NULL,
	"nickname" text NOT NULL,
	"access_token_cifrado" jsonb NOT NULL,
	"refresh_token_cifrado" jsonb NOT NULL,
	"token_expira_ts" timestamp with time zone NOT NULL,
	"renovando_ts" timestamp with time zone,
	"desconectada_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cuentas_ml" ADD CONSTRAINT "cuentas_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cuentas_ml_cuenta_externa_unica" ON "cuentas_ml" USING btree ("cuenta_id_externa");