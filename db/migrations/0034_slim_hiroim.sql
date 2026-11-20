CREATE TABLE IF NOT EXISTS "publicaciones_ia_imagenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"trabajo_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"cuenta_ml_id" uuid,
	"url_cloudinary" text,
	"estado" text DEFAULT 'propuesta' NOT NULL,
	"propuesta" jsonb,
	"diagnostico" jsonb,
	"inicio_generacion_ts" timestamp with time zone,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicaciones_ia_imagenes_estado_valido" CHECK ("publicaciones_ia_imagenes"."estado" in ('propuesta', 'aprobada', 'generando', 'lista', 'error')),
	CONSTRAINT "publicaciones_ia_imagenes_url_https" CHECK ("publicaciones_ia_imagenes"."url_cloudinary" is null or "publicaciones_ia_imagenes"."url_cloudinary" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publicaciones_ia_trabajos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid,
	"cuenta_ml_id" uuid,
	"site_id" text NOT NULL,
	"estilo" text NOT NULL,
	"ficha" jsonb NOT NULL,
	"proveedor" text NOT NULL,
	"modelo" text NOT NULL,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicaciones_ia_trabajos_empresa_id_unica" UNIQUE("empresa_id","id"),
	CONSTRAINT "publicaciones_ia_trabajos_estilo_valido" CHECK ("publicaciones_ia_trabajos"."estilo" in ('zilonix_portadas', 'zilonix_contenido', 'experto_ml')),
	CONSTRAINT "publicaciones_ia_trabajos_estado_valido" CHECK ("publicaciones_ia_trabajos"."estado" in ('abierto', 'cerrado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_imagenes" ADD CONSTRAINT "publicaciones_ia_imagenes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_imagenes" ADD CONSTRAINT "publicaciones_ia_imagenes_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_imagenes" ADD CONSTRAINT "publicaciones_ia_imagenes_trabajo_fk" FOREIGN KEY ("empresa_id","trabajo_id") REFERENCES "public"."publicaciones_ia_trabajos"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_trabajos" ADD CONSTRAINT "publicaciones_ia_trabajos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_trabajos" ADD CONSTRAINT "publicaciones_ia_trabajos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publicaciones_ia_trabajos" ADD CONSTRAINT "publicaciones_ia_trabajos_cuenta_ml_id_cuentas_ml_id_fk" FOREIGN KEY ("cuenta_ml_id") REFERENCES "public"."cuentas_ml"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publicaciones_ia_imagenes_cola_idx" ON "publicaciones_ia_imagenes" USING btree ("empresa_id","estado");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publicaciones_ia_trabajos_empresa_idx" ON "publicaciones_ia_trabajos" USING btree ("empresa_id","creado_ts");