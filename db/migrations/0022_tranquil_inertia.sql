CREATE TABLE IF NOT EXISTS "foro_preguntas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autor_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"cuerpo" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"oculta_ts" timestamp with time zone,
	"oculta_por" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foro_respuestas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregunta_id" uuid NOT NULL,
	"autor_id" uuid NOT NULL,
	"cuerpo" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"oculta_ts" timestamp with time zone,
	"oculta_por" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "foro_preguntas" ADD CONSTRAINT "foro_preguntas_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "foro_preguntas" ADD CONSTRAINT "foro_preguntas_oculta_por_usuarios_id_fk" FOREIGN KEY ("oculta_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "foro_respuestas" ADD CONSTRAINT "foro_respuestas_pregunta_id_foro_preguntas_id_fk" FOREIGN KEY ("pregunta_id") REFERENCES "public"."foro_preguntas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "foro_respuestas" ADD CONSTRAINT "foro_respuestas_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "foro_respuestas" ADD CONSTRAINT "foro_respuestas_oculta_por_usuarios_id_fk" FOREIGN KEY ("oculta_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "foro_preguntas_creado_idx" ON "foro_preguntas" USING btree ("creado_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "foro_respuestas_pregunta_idx" ON "foro_respuestas" USING btree ("pregunta_id","creado_ts");