ALTER TABLE "empresas" ADD COLUMN "plan" text DEFAULT 'prueba' NOT NULL;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "estado" text DEFAULT 'activa' NOT NULL;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "suspendida_motivo" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "suspendida_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "notas_internas" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_plan_valido" CHECK ("empresas"."plan" in ('prueba', 'basico', 'pro', 'empresarial'));--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_estado_valido" CHECK ("empresas"."estado" in ('activa', 'suspendida'));