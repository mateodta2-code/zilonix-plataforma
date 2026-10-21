CREATE TYPE "public"."paso_pedido" AS ENUM('venta', 'pago', 'factura', 'empaque', 'despacho', 'entrega', 'novedades', 'dinero_conciliado');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedido_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"paso" "paso_pedido" NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"actor_tipo" "actor_tipo" NOT NULL,
	"usuario_id" uuid,
	"detalle" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_eventos" ADD CONSTRAINT "pedido_eventos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_eventos" ADD CONSTRAINT "pedido_eventos_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pedido_eventos" ADD CONSTRAINT "pedido_eventos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pedido_eventos_pedido_paso_unico" ON "pedido_eventos" USING btree ("pedido_id","paso");