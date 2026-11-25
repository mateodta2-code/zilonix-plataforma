CREATE TABLE IF NOT EXISTS "anuncios_plataforma" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mensaje" text NOT NULL,
	"tipo" text DEFAULT 'info' NOT NULL,
	"inicio_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"fin_ts" timestamp with time zone,
	"retirado_ts" timestamp with time zone,
	"creado_por" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anuncios_plataforma_tipo_valido" CHECK ("anuncios_plataforma"."tipo" in ('info', 'advertencia', 'peligro')),
	CONSTRAINT "anuncios_plataforma_mensaje_valido" CHECK (length(trim("anuncios_plataforma"."mensaje")) between 1 and 300),
	CONSTRAINT "anuncios_plataforma_fin_despues" CHECK ("anuncios_plataforma"."fin_ts" is null or "anuncios_plataforma"."fin_ts" > "anuncios_plataforma"."inicio_ts")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "anuncios_plataforma" ADD CONSTRAINT "anuncios_plataforma_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
