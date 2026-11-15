CREATE TABLE IF NOT EXISTS "canva_conexiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"access_token_cifrado" jsonb,
	"refresh_token_cifrado" jsonb,
	"token_expira_ts" timestamp with time zone,
	"renovando_ts" timestamp with time zone,
	"desconectada_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canva_conexiones_empresa_usuario_unica" UNIQUE("empresa_id","usuario_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canva_conexiones" ADD CONSTRAINT "canva_conexiones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canva_conexiones" ADD CONSTRAINT "canva_conexiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
