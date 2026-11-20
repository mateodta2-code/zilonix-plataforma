-- 0031: varias IA por empresa (máx. 5), una principal y asignación por módulo.
-- Repetible (IF NOT EXISTS / EXCEPTION). La 0030 la toma feat/promociones-reglas-texto:
-- mergear esa rama ANTES que esta.
-- 1) ia_conexiones: varias por empresa
ALTER TABLE "ia_conexiones" DROP CONSTRAINT IF EXISTS "ia_conexiones_empresa_unica";--> statement-breakpoint
ALTER TABLE "ia_conexiones" ADD COLUMN IF NOT EXISTS "nombre" text DEFAULT 'IA principal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ia_conexiones" ADD COLUMN IF NOT EXISTS "es_principal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexiones" ADD CONSTRAINT "ia_conexiones_nombre_largo" CHECK (char_length("nombre") BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- La fila existente de cada empresa pasa a principal (solo si la empresa aún no tiene una).
UPDATE "ia_conexiones" c SET "es_principal" = true
WHERE c."id" = (SELECT x."id" FROM "ia_conexiones" x WHERE x."empresa_id" = c."empresa_id" ORDER BY x."creado_ts", x."id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "ia_conexiones" y WHERE y."empresa_id" = c."empresa_id" AND y."es_principal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ia_conexiones_una_principal" ON "ia_conexiones" ("empresa_id") WHERE "es_principal";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexiones" ADD CONSTRAINT "ia_conexiones_empresa_id_unica" UNIQUE ("empresa_id", "id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint

-- 2) Límite de 5 por empresa, en la base de datos
CREATE OR REPLACE FUNCTION "ia_conexiones_limite_por_empresa"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."empresa_id"::text));
  IF (SELECT count(*) FROM "ia_conexiones" WHERE "empresa_id" = NEW."empresa_id") >= 5 THEN
    RAISE EXCEPTION 'Puedes conectar hasta 5 IA' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "ia_conexiones_limite" ON "ia_conexiones";--> statement-breakpoint
CREATE TRIGGER "ia_conexiones_limite" BEFORE INSERT ON "ia_conexiones"
  FOR EACH ROW EXECUTE FUNCTION "ia_conexiones_limite_por_empresa"();--> statement-breakpoint

-- 3) Asignación de módulos
CREATE TABLE IF NOT EXISTS "ia_conexion_modulos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"conexion_id" uuid NOT NULL,
	"modulo" text NOT NULL,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_conexion_modulos_modulo_valido" CHECK ("modulo" IN ('promociones','optimizacion','investigacion','publicidad','generacion_imagenes','publicaciones')),
	CONSTRAINT "ia_conexion_modulos_empresa_modulo_unico" UNIQUE ("empresa_id", "modulo")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexion_modulos" ADD CONSTRAINT "ia_conexion_modulos_empresa_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_conexion_modulos" ADD CONSTRAINT "ia_conexion_modulos_conexion_fk" FOREIGN KEY ("empresa_id", "conexion_id") REFERENCES "public"."ia_conexiones"("empresa_id", "id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
