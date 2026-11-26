ALTER TABLE "mensajes_ticket_soporte" ADD COLUMN "imagenes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets_soporte" ADD COLUMN "imagenes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "mensajes_ticket_soporte" ADD CONSTRAINT "mensajes_ticket_soporte_max_imagenes" CHECK (cardinality("mensajes_ticket_soporte"."imagenes") <= 3);--> statement-breakpoint
ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_max_imagenes" CHECK (cardinality("tickets_soporte"."imagenes") <= 3);