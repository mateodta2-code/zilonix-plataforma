CREATE TABLE IF NOT EXISTS "publicaciones_falabella" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_falabella_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"titulo" text NOT NULL,
	"borrador" jsonb NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"feed_producto_id" text,
	"feed_imagenes_id" text,
	"errores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creado_por_usuario_id" uuid,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicaciones_falabella_estado_valido" CHECK ("publicaciones_falabella"."estado" IN ('borrador', 'creando', 'imagenes', 'publicado', 'rechazado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_falabella" ADD CONSTRAINT "publicaciones_falabella_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_falabella" ADD CONSTRAINT "publicaciones_falabella_creado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_falabella" ADD CONSTRAINT "publicaciones_falabella_cuenta_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_falabella_id") REFERENCES "public"."cuentas_falabella"("empresa_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publicaciones_falabella_empresa_creado_idx" ON "publicaciones_falabella" USING btree ("empresa_id","creado_ts");