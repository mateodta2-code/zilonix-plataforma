ALTER TABLE "despachos_ml" ADD COLUMN "sla_expected_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despachos_ml" ADD COLUMN "guia_vista_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despachos_ml" ADD COLUMN "despachado_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despachos_ml" ADD COLUMN "despachado_por" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "despachos_ml" ADD CONSTRAINT "despachos_ml_despachado_por_usuarios_id_fk" FOREIGN KEY ("despachado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
