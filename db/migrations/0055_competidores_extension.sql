CREATE TABLE IF NOT EXISTS "optimizacion_competidores_ext" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid,
	"item_id" text NOT NULL,
	"termino" text NOT NULL,
	"candidatos" integer DEFAULT 0 NOT NULL,
	"competidores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"leido_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	CONSTRAINT "optimizacion_competidores_ext_empresa_item_unico" UNIQUE("empresa_id","item_id"),
	CONSTRAINT "optimizacion_competidores_ext_item_valido" CHECK ("optimizacion_competidores_ext"."item_id" ~ '^[A-Z]{3}[0-9]{6,15}$'),
	CONSTRAINT "optimizacion_competidores_ext_termino_largo" CHECK (char_length("optimizacion_competidores_ext"."termino") <= 120)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_competidores_ext" ADD CONSTRAINT "optimizacion_competidores_ext_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_competidores_ext" ADD CONSTRAINT "optimizacion_competidores_ext_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_competidores_ext" ADD CONSTRAINT "optimizacion_competidores_ext_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
