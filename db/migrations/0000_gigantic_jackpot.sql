CREATE TYPE "public"."accion" AS ENUM('consultar', 'crear', 'modificar', 'anular', 'autorizar');--> statement-breakpoint
CREATE TYPE "public"."actor_tipo" AS ENUM('persona', 'sistema');--> statement-breakpoint
CREATE TYPE "public"."alcance" AS ENUM('todo', 'propio');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid,
	"usuario_id" uuid,
	"actor_tipo" "actor_tipo" NOT NULL,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"detalle" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"nit" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_nit_unique" UNIQUE("nit")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"email" text NOT NULL,
	"rol_id" uuid NOT NULL,
	"token" text NOT NULL,
	"invitado_por" uuid NOT NULL,
	"expira_ts" timestamp with time zone NOT NULL,
	"aceptada_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitaciones_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membresias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"rol_id" uuid NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permisos_rol" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rol_id" uuid NOT NULL,
	"modulo" text NOT NULL,
	"accion" "accion" NOT NULL,
	"alcance" "alcance" DEFAULT 'todo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"empresa_id" uuid,
	"es_plantilla" boolean DEFAULT false NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"clerk_user_id" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_invitado_por_usuarios_id_fk" FOREIGN KEY ("invitado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membresias" ADD CONSTRAINT "membresias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membresias" ADD CONSTRAINT "membresias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membresias" ADD CONSTRAINT "membresias_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permisos_rol" ADD CONSTRAINT "permisos_rol_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles" ADD CONSTRAINT "roles_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membresias_usuario_empresa_unica" ON "membresias" USING btree ("usuario_id","empresa_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permisos_rol_unica" ON "permisos_rol" USING btree ("rol_id","modulo","accion");