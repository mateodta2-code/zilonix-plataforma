CREATE TABLE IF NOT EXISTS "pagos_mp_por_cobrar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_mp_id" uuid NOT NULL,
	"pago_id_externo" text NOT NULL,
	"orden_id_externo" text,
	"estado" text NOT NULL,
	"estado_liberacion" text,
	"fecha_liberacion" timestamp with time zone,
	"monto_neto" numeric(14, 2),
	"moneda" text NOT NULL,
	"tipo" text NOT NULL,
	"sincronizado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagos_mp_por_cobrar_pago_unico" UNIQUE("cuenta_mp_id","pago_id_externo"),
	CONSTRAINT "pagos_mp_por_cobrar_moneda_iso" CHECK ("pagos_mp_por_cobrar"."moneda" ~ '^[A-Z]{3}$'),
	CONSTRAINT "pagos_mp_por_cobrar_tipo_valido" CHECK ("pagos_mp_por_cobrar"."tipo" in ('por_liberar', 'retenido'))
);
--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "por_cobrar_sincronizado_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cuentas_mp" ADD COLUMN "ultimo_error_por_cobrar" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pagos_mp_por_cobrar" ADD CONSTRAINT "pagos_mp_por_cobrar_cuenta_de_la_empresa" FOREIGN KEY ("empresa_id","cuenta_mp_id") REFERENCES "public"."cuentas_mp"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagos_mp_por_cobrar_empresa_cuenta_idx" ON "pagos_mp_por_cobrar" USING btree ("empresa_id","cuenta_mp_id");