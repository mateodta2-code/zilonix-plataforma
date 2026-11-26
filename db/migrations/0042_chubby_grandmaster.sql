ALTER TABLE "cuentas_falabella" ADD COLUMN IF NOT EXISTS "iva_ventas_pct" numeric(5, 2);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cuentas_falabella" ADD CONSTRAINT "cuentas_falabella_iva_ventas_pct_rango" CHECK ("cuentas_falabella"."iva_ventas_pct" >= 0 AND "cuentas_falabella"."iva_ventas_pct" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
