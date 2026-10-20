CREATE TABLE IF NOT EXISTS "avisos_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id_externa" text NOT NULL,
	"topic" text NOT NULL,
	"resource" text NOT NULL,
	"enviado_ts" timestamp with time zone NOT NULL,
	"recibido_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"procesado_ts" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avisos_ml" ADD CONSTRAINT "avisos_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avisos_ml_unico" ON "avisos_ml" USING btree ("cuenta_id_externa","topic","resource","enviado_ts");