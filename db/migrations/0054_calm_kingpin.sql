ALTER TABLE "cuentas_mp" ADD COLUMN "ultimo_saldo_disponible" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "ultima_moneda" text;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "ultimo_corte_fecha" text;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "ultimo_saldo_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "reporte_pendiente_file" text;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "reporte_pendiente_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "ultimo_error_saldo" text;