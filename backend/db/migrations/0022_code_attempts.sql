CREATE TABLE "auth_send_counts" (
	"bucket" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_send_counts_bucket_day_pk" PRIMARY KEY("bucket","day")
);
--> statement-breakpoint
-- Email codes move to hashed storage with a purpose. Existing rows hold plaintext
-- codes, have no hash or purpose, and expire within 10 minutes anyway, so they are
-- deleted rather than migrated: anyone mid-sign-in just requests a new code.
-- The table only ever holds a few minutes of rows, so this is a small delete.
DELETE FROM "email_codes";--> statement-breakpoint
ALTER TABLE "email_codes" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "code_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "purpose" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "handoff_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_send_counts_day_idx" ON "auth_send_counts" USING btree ("day");--> statement-breakpoint
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;