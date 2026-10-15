CREATE TABLE IF NOT EXISTS "accesos_temporales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"concedido_por" uuid NOT NULL,
	"alcance" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_ts" timestamp with time zone NOT NULL,
	"revocado_ts" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "es_superadmin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accesos_temporales" ADD CONSTRAINT "accesos_temporales_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accesos_temporales" ADD CONSTRAINT "accesos_temporales_concedido_por_usuarios_id_fk" FOREIGN KEY ("concedido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
