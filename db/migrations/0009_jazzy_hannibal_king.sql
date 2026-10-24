CREATE TYPE "public"."alerta_seguimiento_tipo" AS ENUM('precio_bajo', 'precio_subio', 'entro_catalogo', 'salio_catalogo', 'gano_boton_compra', 'perdio_boton_compra', 'inventario_bajo', 'vendio_unidades', 'pausada', 'finalizada', 'publicacion_nueva', 'publicacion_eliminada');--> statement-breakpoint
CREATE TYPE "public"."seguimiento_recurso_ml" AS ENUM('item', 'product', 'seller');--> statement-breakpoint
CREATE TYPE "public"."seguimiento_tipo" AS ENUM('producto', 'tienda');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seguimiento_alertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"seguimiento_id" uuid NOT NULL,
	"foto_id" uuid NOT NULL,
	"tipo" "alerta_seguimiento_tipo" NOT NULL,
	"detalle" jsonb NOT NULL,
	"leida_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seguimiento_fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"seguimiento_id" uuid NOT NULL,
	"fecha" timestamp NOT NULL,
	"precio" numeric(14, 2),
	"precio_anterior" numeric(14, 2),
	"inventario_disponible" integer,
	"inventario_aproximado" boolean DEFAULT false NOT NULL,
	"vendidos" integer,
	"estado" text,
	"en_catalogo" boolean,
	"gana_boton_compra" boolean,
	"es_full" boolean,
	"es_envio_gratis" boolean,
	"publicaciones" jsonb,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seguimientos_ml" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" "seguimiento_tipo" NOT NULL,
	"recurso_ml" "seguimiento_recurso_ml" NOT NULL,
	"ml_id_externo" text NOT NULL,
	"nombre" text NOT NULL,
	"link_original" text NOT NULL,
	"es_competidor" boolean DEFAULT false NOT NULL,
	"creado_por" uuid NOT NULL,
	"eliminado_ts" timestamp with time zone,
	"ultima_revision_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimiento_alertas" ADD CONSTRAINT "seguimiento_alertas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimiento_alertas" ADD CONSTRAINT "seguimiento_alertas_seguimiento_id_seguimientos_ml_id_fk" FOREIGN KEY ("seguimiento_id") REFERENCES "public"."seguimientos_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimiento_alertas" ADD CONSTRAINT "seguimiento_alertas_foto_id_seguimiento_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."seguimiento_fotos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimiento_fotos" ADD CONSTRAINT "seguimiento_fotos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimiento_fotos" ADD CONSTRAINT "seguimiento_fotos_seguimiento_id_seguimientos_ml_id_fk" FOREIGN KEY ("seguimiento_id") REFERENCES "public"."seguimientos_ml"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimientos_ml" ADD CONSTRAINT "seguimientos_ml_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguimientos_ml" ADD CONSTRAINT "seguimientos_ml_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seguimiento_fotos_seguimiento_fecha_unica" ON "seguimiento_fotos" USING btree ("seguimiento_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seguimientos_ml_empresa_recurso_unico" ON "seguimientos_ml" USING btree ("empresa_id","ml_id_externo");