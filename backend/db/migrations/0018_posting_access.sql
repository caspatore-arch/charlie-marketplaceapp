CREATE TYPE "public"."posting_access" AS ENUM('default', 'approved', 'blocked');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posting_access" "posting_access" DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posting_access_changed_at" timestamp with time zone;