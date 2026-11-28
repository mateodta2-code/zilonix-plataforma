CREATE TABLE IF NOT EXISTS "pagos_terceros_ventas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tercero_id" uuid NOT NULL,
	"periodo_desde" date NOT NULL,
	"periodo_hasta" date NOT NULL,
	"moneda" text NOT NULL,
	"monto" numeric(14, 2) NOT NULL,
	"fecha_pago" date NOT NULL,
	"medio_pago" text,
	"creado_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid,
	CONSTRAINT "pagos_terceros_ventas_periodo_valido" CHECK ("pagos_terceros_ventas"."periodo_hasta" >= "pagos_terceros_ventas"."periodo_desde"),
	CONSTRAINT "pagos_terceros_ventas_monto_positivo" CHECK ("pagos_terceros_ventas"."monto" > 0),
	CONSTRAINT "pagos_terceros_ventas_moneda_iso" CHECK ("pagos_terceros_ventas"."moneda" ~ '^[A-Z]{3}$'),
	CONSTRAINT "pagos_terceros_ventas_medio_pago_largo" CHECK ("pagos_terceros_ventas"."medio_pago" is null or char_length("pagos_terceros_ventas"."medio_pago") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "por_pagar_ventas_desde" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pedidos_finanzas" ADD COLUMN "empaque_tercero_id" uuid;--> statement-breakpoint
ALTER TABLE "pedidos_finanzas" ADD COLUMN "envio_tercero_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pagos_terceros_ventas" ADD CONSTRAINT "pagos_terceros_ventas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pagos_terceros_ventas" ADD CONSTRAINT "pagos_terceros_ventas_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pagos_terceros_ventas" ADD CONSTRAINT "pagos_terceros_ventas_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagos_terceros_ventas_empresa_tercero_periodo_idx" ON "pagos_terceros_ventas" USING btree ("empresa_id","tercero_id","periodo_desde");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_finanzas" ADD CONSTRAINT "pedidos_finanzas_empaque_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","empaque_tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedidos_finanzas" ADD CONSTRAINT "pedidos_finanzas_envio_tercero_misma_empresa_fk" FOREIGN KEY ("empresa_id","envio_tercero_id") REFERENCES "public"."terceros"("empresa_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
