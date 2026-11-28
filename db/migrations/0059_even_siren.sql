ALTER TABLE "ordenes_compra" ADD COLUMN "fecha_compra" date;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "forma_pago" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "plataforma" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "orden_plataforma" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "link_compra" text;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD COLUMN "entrega_estimada" date;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_forma_pago_largo" CHECK ("ordenes_compra"."forma_pago" is null or char_length("ordenes_compra"."forma_pago") between 1 and 60);--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_plataforma_largo" CHECK ("ordenes_compra"."plataforma" is null or char_length("ordenes_compra"."plataforma") between 1 and 40);--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_orden_plataforma_largo" CHECK ("ordenes_compra"."orden_plataforma" is null or char_length("ordenes_compra"."orden_plataforma") between 1 and 80);--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_link_compra_http" CHECK ("ordenes_compra"."link_compra" is null or ("ordenes_compra"."link_compra" ~* '^https?://' and char_length("ordenes_compra"."link_compra") <= 500));