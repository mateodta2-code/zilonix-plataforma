ALTER TABLE "ordenes_compra" ADD COLUMN "fecha_pago" date;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "medio_pago" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_medio_con_fecha" CHECK ("ordenes_compra"."medio_pago" is null or "ordenes_compra"."fecha_pago" is not null);