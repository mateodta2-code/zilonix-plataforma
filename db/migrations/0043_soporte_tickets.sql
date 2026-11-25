DO $$ BEGIN
 CREATE TYPE "public"."estado_ticket_soporte" AS ENUM('abierto', 'en_curso', 'resuelto');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mensajes_ticket_soporte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"autor_usuario_id" uuid NOT NULL,
	"es_superadmin" boolean DEFAULT false NOT NULL,
	"mensaje" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets_soporte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"creado_por" uuid NOT NULL,
	"asunto" text NOT NULL,
	"mensaje" text NOT NULL,
	"modulo" text NOT NULL,
	"estado" "estado_ticket_soporte" DEFAULT 'abierto' NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ticket_soporte" ADD CONSTRAINT "mensajes_ticket_soporte_ticket_id_tickets_soporte_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets_soporte"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ticket_soporte" ADD CONSTRAINT "mensajes_ticket_soporte_autor_usuario_id_usuarios_id_fk" FOREIGN KEY ("autor_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mensajes_ticket_soporte_ticket_idx" ON "mensajes_ticket_soporte" USING btree ("ticket_id","creado_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_soporte_empresa_idx" ON "tickets_soporte" USING btree ("empresa_id","actualizado_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_soporte_estado_idx" ON "tickets_soporte" USING btree ("estado","actualizado_ts");