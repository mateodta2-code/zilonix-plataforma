CREATE TYPE "public"."estado_bodega_3pl" AS ENUM('activa', 'suspendida');--> statement-breakpoint
CREATE TYPE "public"."rol_bodega_3pl" AS ENUM('admin_bodega', 'operario', 'domiciliario');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bodegas_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"nit" text,
	"estado" "estado_bodega_3pl" DEFAULT 'activa' NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitaciones_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"email" text NOT NULL,
	"rol" "rol_bodega_3pl" NOT NULL,
	"bodega_nombre" text NOT NULL,
	"token" text NOT NULL,
	"invitado_por" uuid NOT NULL,
	"expira_ts" timestamp with time zone NOT NULL,
	"aceptada_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitaciones_bodega_3pl_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "miembros_bodega_3pl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bodega_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"rol" "rol_bodega_3pl" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD COLUMN "bodega_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitaciones_bodega_3pl" ADD CONSTRAINT "invitaciones_bodega_3pl_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitaciones_bodega_3pl" ADD CONSTRAINT "invitaciones_bodega_3pl_invitado_por_usuarios_id_fk" FOREIGN KEY ("invitado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "miembros_bodega_3pl" ADD CONSTRAINT "miembros_bodega_3pl_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "miembros_bodega_3pl" ADD CONSTRAINT "miembros_bodega_3pl_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "miembros_bodega_3pl_usuario_bodega_unica" ON "miembros_bodega_3pl" USING btree ("usuario_id","bodega_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_bodega_id_bodegas_3pl_id_fk" FOREIGN KEY ("bodega_id") REFERENCES "public"."bodegas_3pl"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
