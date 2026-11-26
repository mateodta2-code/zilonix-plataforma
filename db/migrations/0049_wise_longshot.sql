CREATE TYPE "public"."tipo_novedad_entrega" AS ENUM('voy_tarde', 'reprogramar', 'no_contesta', 'paquete_danado', 'otro');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entregas_novedades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entrega_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"bodega_id" uuid NOT NULL,
	"usuario_id" uuid,
	"tipo" "tipo_novedad_entrega" NOT NULL,
	"detalle" text,
	"foto_public_id" text,
	"creada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entregas_novedades_detalle_valido" CHECK (("entregas_novedades"."tipo" <> 'otro' or length(trim(coalesce("entregas_novedades"."detalle", ''))) > 0) and length(coalesce("entregas_novedades"."detalle", '')) <= 200)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_novedades" ADD CONSTRAINT "entregas_novedades_entrega_id_entregas_domiciliario_id_fk" FOREIGN KEY ("entrega_id") REFERENCES "public"."entregas_domiciliario"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_novedades" ADD CONSTRAINT "entregas_novedades_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_novedades" ADD CONSTRAINT "entregas_novedades_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_novedades" ADD CONSTRAINT "entregas_novedades_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entregas_novedades_entrega_idx" ON "entregas_novedades" USING btree ("entrega_id","creada_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entregas_novedades_empresa_idx" ON "entregas_novedades" USING btree ("empresa_id");