CREATE TYPE "public"."tipo_mensaje_ml" AS ENUM('pregunta', 'mensaje', 'reclamo');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mensajes_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_ml_id" uuid NOT NULL,
	"tipo" "tipo_mensaje_ml" NOT NULL,
	"external_id" text NOT NULL,
	"item_id" text,
	"item_titulo" text,
	"item_permalink" text,
	"comprador_id" text,
	"comprador_nickname" text,
	"texto" text,
	"estado" text,
	"respondida" boolean DEFAULT false NOT NULL,
	"asignado_a" uuid,
	"vence_por_responder_ts" timestamp with time zone,
	"detalle" jsonb,
	"ocurrido_ts" timestamp with time zone,
	"recibido_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mensajes_ml_hilo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"mensaje_ml_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"de_comprador" boolean NOT NULL,
	"texto" text,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ml" ADD CONSTRAINT "mensajes_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ml" ADD CONSTRAINT "mensajes_ml_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ml" ADD CONSTRAINT "mensajes_ml_asignado_a_usuarios_id_fk" FOREIGN KEY ("asignado_a") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ml_hilo" ADD CONSTRAINT "mensajes_ml_hilo_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensajes_ml_hilo" ADD CONSTRAINT "mensajes_ml_hilo_mensaje_ml_id_mensajes_ml_id_fk" FOREIGN KEY ("mensaje_ml_id") REFERENCES "public"."mensajes_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mensajes_ml_empresa_tipo_externo_unico" ON "mensajes_ml" USING btree ("empresa_id","tipo","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mensajes_ml_hilo_unico" ON "mensajes_ml_hilo" USING btree ("mensaje_ml_id","external_id");