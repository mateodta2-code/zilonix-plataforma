CREATE TYPE "public"."estado_producto_ml" AS ENUM('borrador', 'publicando', 'publicado', 'con_errores');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "productos_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"titulo" text,
	"condicion" text DEFAULT 'new' NOT NULL,
	"precio" numeric(14, 2) NOT NULL,
	"stock" integer DEFAULT 1 NOT NULL,
	"envio_gratis" boolean DEFAULT false NOT NULL,
	"sku" text,
	"dimensiones" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imagenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"atributos_extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"categorias_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variantes" jsonb,
	"por_cuenta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cuentas_seleccionadas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modo_prueba" boolean DEFAULT false NOT NULL,
	"estado" "estado_producto_ml" DEFAULT 'borrador' NOT NULL,
	"resultado" jsonb,
	"publicado_ts" timestamp with time zone,
	"creado_por_usuario_id" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "productos_ml" ADD CONSTRAINT "productos_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "productos_ml" ADD CONSTRAINT "productos_ml_creado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
