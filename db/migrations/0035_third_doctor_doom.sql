CREATE TABLE IF NOT EXISTS "optimizacion_notas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid,
	"item_id" text NOT NULL,
	"fecha_cambio" timestamp with time zone DEFAULT now() NOT NULL,
	"texto" text NOT NULL,
	"usuario_id" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimizacion_notas_item_valido" CHECK ("optimizacion_notas"."item_id" ~ '^[A-Z]{3}[0-9]{6,15}$'),
	CONSTRAINT "optimizacion_notas_texto_largo" CHECK (char_length("optimizacion_notas"."texto") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "optimizacion_revisiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cambio_ref" text NOT NULL,
	"item_id" text NOT NULL,
	"resultado" text NOT NULL,
	"comentario" text,
	"usuario_id" uuid,
	"revisado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimizacion_revisiones_empresa_cambio_unico" UNIQUE("empresa_id","cambio_ref"),
	CONSTRAINT "optimizacion_revisiones_ref_valida" CHECK ("optimizacion_revisiones"."cambio_ref" ~ '^(auditoria|nota):[0-9a-f-]{36}$'),
	CONSTRAINT "optimizacion_revisiones_resultado_valido" CHECK ("optimizacion_revisiones"."resultado" in ('sirvio', 'no_sirvio', 'sin_cambio')),
	CONSTRAINT "optimizacion_revisiones_comentario_largo" CHECK ("optimizacion_revisiones"."comentario" is null or char_length("optimizacion_revisiones"."comentario") <= 500)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_notas" ADD CONSTRAINT "optimizacion_notas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_notas" ADD CONSTRAINT "optimizacion_notas_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_notas" ADD CONSTRAINT "optimizacion_notas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_revisiones" ADD CONSTRAINT "optimizacion_revisiones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizacion_revisiones" ADD CONSTRAINT "optimizacion_revisiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "optimizacion_notas_empresa_item_idx" ON "optimizacion_notas" USING btree ("empresa_id","item_id","fecha_cambio");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "optimizacion_revisiones_empresa_item_idx" ON "optimizacion_revisiones" USING btree ("empresa_id","item_id");