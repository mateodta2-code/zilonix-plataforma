DO $$ BEGIN
 CREATE TYPE "public"."origen_bodega_3pl" AS ENUM('superadmin', 'autorregistro');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "perfiles_domiciliario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"telefono" text,
	"ciudad" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfiles_domiciliario_usuario_id_unique" UNIQUE("usuario_id")
);
--> statement-breakpoint
ALTER TABLE "bodegas_3pl" ADD COLUMN IF NOT EXISTS "origen" "origen_bodega_3pl" DEFAULT 'superadmin' NOT NULL;--> statement-breakpoint
ALTER TABLE "bodegas_3pl" ADD COLUMN IF NOT EXISTS "creado_por" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "perfiles_domiciliario" ADD CONSTRAINT "perfiles_domiciliario_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bodegas_3pl" ADD CONSTRAINT "bodegas_3pl_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bodegas_3pl_autorregistro_unica" ON "bodegas_3pl" USING btree ("creado_por") WHERE "bodegas_3pl"."origen" = 'autorregistro';