ALTER TABLE "pedidos_finanzas" ADD COLUMN "fecha_liberacion" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos_finanzas" ADD COLUMN "estado_liberacion" text;--> statement-breakpoint
ALTER TABLE "pedidos_finanzas" ADD COLUMN "monto_por_liberar" numeric(14, 2);