ALTER TABLE "costos_sku" ADD COLUMN "sku_falabella" text;--> statement-breakpoint
ALTER TABLE "cuentas_falabella" ADD COLUMN "comision_defecto_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "cuentas_falabella" ADD COLUMN "flete_defecto" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pedidos_falabella" ADD COLUMN "costo_manual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pedidos_falabella" ADD COLUMN "flete_manual" numeric(14, 2);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "costos_sku_empresa_sku_falabella_unico" ON "costos_sku" USING btree ("empresa_id","sku_falabella") WHERE sku_falabella IS NOT NULL;--> statement-breakpoint
ALTER TABLE "costos_sku" ADD CONSTRAINT "costos_sku_sku_falabella_normalizado" CHECK ("costos_sku"."sku_falabella" IS NULL OR ("costos_sku"."sku_falabella" = upper(btrim("costos_sku"."sku_falabella")) AND "costos_sku"."sku_falabella" <> ''));--> statement-breakpoint
ALTER TABLE "cuentas_falabella" ADD CONSTRAINT "cuentas_falabella_comision_defecto_pct_rango" CHECK ("cuentas_falabella"."comision_defecto_pct" >= 0 AND "cuentas_falabella"."comision_defecto_pct" <= 100);--> statement-breakpoint
ALTER TABLE "cuentas_falabella" ADD CONSTRAINT "cuentas_falabella_flete_defecto_no_negativo" CHECK ("cuentas_falabella"."flete_defecto" >= 0);--> statement-breakpoint
ALTER TABLE "pedidos_falabella" ADD CONSTRAINT "pedidos_falabella_costo_manual_no_negativo" CHECK ("pedidos_falabella"."costo_manual" >= 0);--> statement-breakpoint
ALTER TABLE "pedidos_falabella" ADD CONSTRAINT "pedidos_falabella_flete_manual_no_negativo" CHECK ("pedidos_falabella"."flete_manual" >= 0);