ALTER TABLE "users" ADD COLUMN "instagram_handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "share_instagram" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "share_phone" boolean DEFAULT false NOT NULL;