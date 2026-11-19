ALTER TABLE "cuentas_falabella" ADD CONSTRAINT "cuentas_falabella_empresa_id_unica" UNIQUE("empresa_id","id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movimientos_marketplace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"marketplace" text NOT NULL,
	"cuenta_falabella_id" uuid,
	"numero_orden" text,
	"sku" text,
	"id_articulo" text,
	"tipo_transaccion" text NOT NULL,
	"categoria" text NOT NULL,
	"moneda" text NOT NULL,
	"monto_sin_iva" numeric(16, 4),
	"iva" numeric(16, 4),
	"monto" numeric(16, 4) NOT NULL,
	"fecha_transaccion" date,
	"estado_pago" text,
	"estado_cuenta" text,
	"referencia_pago" text,
	"documento_tributario" text,
	"huella" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimientos_marketplace_marketplace_valido" CHECK ("movimientos_marketplace"."marketplace" in ('falabella')),
	CONSTRAINT "movimientos_marketplace_cuenta_segun_marketplace" CHECK ("movimientos_marketplace"."marketplace" <> 'falabella' OR "movimientos_marketplace"."cuenta_falabella_id" IS NOT NULL),
	CONSTRAINT "movimientos_marketplace_categoria_valida" CHECK ("movimientos_marketplace"."categoria" in ('precio', 'comision', 'envio', 'promocion', 'retencion', 'publicidad', 'fulfillment', 'devolucion', 'ajuste', 'otro'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movimientos_marketplace" ADD CONSTRAINT "movimientos_marketplace_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movimientos_marketplace" ADD CONSTRAINT "movimientos_marketplace_cuenta_falabella_misma_empresa_fk" FOREIGN KEY ("empresa_id","cuenta_falabella_id") REFERENCES "public"."cuentas_falabella"("empresa_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movimientos_marketplace_linea_unica" ON "movimientos_marketplace" USING btree ("empresa_id","marketplace","huella");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movimientos_marketplace_estado_cuenta_idx" ON "movimientos_marketplace" USING btree ("empresa_id","estado_cuenta");
