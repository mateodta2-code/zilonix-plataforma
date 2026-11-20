ALTER TABLE "promociones_reglas" ADD COLUMN IF NOT EXISTS "regla_participacion" text;--> statement-breakpoint
ALTER TABLE "promociones_reglas" ADD COLUMN IF NOT EXISTS "reglas_adicionales_texto" text;--> statement-breakpoint
ALTER TABLE "promociones_reglas" ADD COLUMN IF NOT EXISTS "reglas_adicionales_json" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_regla_participacion_valida" CHECK ("regla_participacion" IS NULL OR "regla_participacion" IN ('todas','maximo','tabla-maestra'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "promociones_reglas" ADD CONSTRAINT "promociones_reglas_reglas_texto_largo" CHECK ("reglas_adicionales_texto" IS NULL OR char_length("reglas_adicionales_texto") <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
