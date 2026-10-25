CREATE TYPE "public"."seguimiento_franja" AS ENUM('manana', 'tarde');--> statement-breakpoint
DROP INDEX IF EXISTS "seguimiento_fotos_seguimiento_fecha_unica";--> statement-breakpoint
ALTER TABLE "seguimiento_fotos" ADD COLUMN "franja" "seguimiento_franja" DEFAULT 'manana' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seguimiento_fotos_seguimiento_fecha_franja_unica" ON "seguimiento_fotos" USING btree ("seguimiento_id","fecha","franja");