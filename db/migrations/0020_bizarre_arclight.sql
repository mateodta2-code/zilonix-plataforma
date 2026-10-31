ALTER TABLE "cuentas_ml" ADD COLUMN "site_id" text DEFAULT 'MCO' NOT NULL;--> statement-breakpoint
ALTER TABLE "cuentas_ml" ADD COLUMN "moneda" text DEFAULT 'COP' NOT NULL;--> statement-breakpoint
ALTER TABLE "cuentas_ml" ADD COLUMN "idioma" text DEFAULT 'es-CO' NOT NULL;--> statement-breakpoint
ALTER TABLE "cuentas_ml" ADD CONSTRAINT "cuentas_ml_site_id_valido" CHECK ("cuentas_ml"."site_id" IN ('MCO', 'MLM', 'MLB', 'MLA', 'MLC'));