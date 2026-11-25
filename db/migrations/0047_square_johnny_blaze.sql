CREATE TABLE IF NOT EXISTS "ejecuciones_procesos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proceso" text NOT NULL,
	"inicio_ts" timestamp with time zone NOT NULL,
	"fin_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"resumen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "ejecuciones_procesos_proceso_valido" CHECK ("ejecuciones_procesos"."proceso" in ('avisos_ml', 'publicidad', 'seguimiento'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ejecuciones_procesos_proceso_inicio" ON "ejecuciones_procesos" USING btree ("proceso","inicio_ts");