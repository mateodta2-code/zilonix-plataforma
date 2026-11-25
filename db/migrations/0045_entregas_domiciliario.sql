DO $$ BEGIN
 CREATE TYPE "public"."estado_entrega_domiciliario" AS ENUM('asignada', 'en_camino', 'entregada', 'no_entregada');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entregas_domiciliario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"bodega_id" uuid NOT NULL,
	"miembro_domiciliario_id" uuid NOT NULL,
	"marketplace" text DEFAULT 'mercadolibre' NOT NULL,
	"pedido_referencia" text NOT NULL,
	"estado" "estado_entrega_domiciliario" DEFAULT 'asignada' NOT NULL,
	"motivo" text,
	"asignada_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entregas_domiciliario_contacto" (
	"entrega_id" uuid PRIMARY KEY NOT NULL,
	"empresa_id" uuid NOT NULL,
	"receptor_nombre" text NOT NULL,
	"direccion" text NOT NULL,
	"barrio" text,
	"ciudad" text NOT NULL,
	"telefono" text NOT NULL,
	"nota" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_domiciliario" ADD CONSTRAINT "entregas_domiciliario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_domiciliario" ADD CONSTRAINT "entregas_domiciliario_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_domiciliario" ADD CONSTRAINT "entregas_domiciliario_miembro_domiciliario_id_miembros_bodega_3pl_id_fk" FOREIGN KEY ("miembro_domiciliario_id") REFERENCES "public"."miembros_bodega_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_domiciliario_contacto" ADD CONSTRAINT "entregas_domiciliario_contacto_entrega_id_entregas_domiciliario_id_fk" FOREIGN KEY ("entrega_id") REFERENCES "public"."entregas_domiciliario"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entregas_domiciliario_contacto" ADD CONSTRAINT "entregas_domiciliario_contacto_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entregas_domiciliario_pedido_unica" ON "entregas_domiciliario" USING btree ("empresa_id","marketplace","pedido_referencia");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entregas_domiciliario_miembro_idx" ON "entregas_domiciliario" USING btree ("miembro_domiciliario_id","estado");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entregas_domiciliario_bodega_idx" ON "entregas_domiciliario" USING btree ("bodega_id","estado");