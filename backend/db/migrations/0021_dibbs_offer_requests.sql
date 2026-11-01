CREATE TYPE "public"."dibbs_offer_status" AS ENUM('submitted', 'in_review', 'needs_info', 'offered', 'meetup_proposed', 'meetup_confirmed', 'final_offer', 'final_accepted', 'completed', 'declined', 'seller_declined', 'final_declined', 'withdrawn', 'expired', 'closed');--> statement-breakpoint
CREATE TABLE "dibbs_offer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"message" text,
	"amount_low_cents" integer,
	"amount_high_cents" integer,
	"spot_id" uuid,
	"starts_at" timestamp with time zone,
	"visible_to_seller" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dibbs_offer_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid NOT NULL,
	"request_id" uuid,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dibbs_offer_media_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "dibbs_offer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"kind" text NOT NULL,
	"ref_version" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dibbs_offer_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "dibbs_offer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"listing_id" uuid,
	"client_request_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"condition" "condition",
	"specs" text,
	"description" text,
	"status" "dibbs_offer_status" DEFAULT 'submitted' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"assigned_staff_id" uuid,
	"estimate_kind" text,
	"estimate_low_cents" integer,
	"estimate_high_cents" integer,
	"estimate_version" integer DEFAULT 0 NOT NULL,
	"estimate_sent_at" timestamp with time zone,
	"estimate_expires_at" timestamp with time zone,
	"meetup_spot_id" uuid,
	"meetup_starts_at" timestamp with time zone,
	"meetup_proposed_by" text,
	"meetup_confirmed_at" timestamp with time zone,
	"holds_listing" boolean DEFAULT false NOT NULL,
	"final_offer_cents" integer,
	"final_offer_version" integer DEFAULT 0 NOT NULL,
	"final_offer_sent_at" timestamp with time zone,
	"final_accepted_cents" integer,
	"final_accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"payout_status" text DEFAULT 'not_recorded' NOT NULL,
	"payout_recorded_at" timestamp with time zone,
	"closed_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dibbs_offer_estimate_valid" CHECK (("dibbs_offer_requests"."estimate_low_cents" is null and "dibbs_offer_requests"."estimate_high_cents" is null) or (
        "dibbs_offer_requests"."estimate_low_cents" > 0 and "dibbs_offer_requests"."estimate_high_cents" >= "dibbs_offer_requests"."estimate_low_cents"
      )),
	CONSTRAINT "dibbs_offer_final_positive" CHECK ("dibbs_offer_requests"."final_offer_cents" is null or "dibbs_offer_requests"."final_offer_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "dibbs_offer_events" ADD CONSTRAINT "dibbs_offer_events_request_id_dibbs_offer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."dibbs_offer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_events" ADD CONSTRAINT "dibbs_offer_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_media" ADD CONSTRAINT "dibbs_offer_media_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_media" ADD CONSTRAINT "dibbs_offer_media_request_id_dibbs_offer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."dibbs_offer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_notifications" ADD CONSTRAINT "dibbs_offer_notifications_request_id_dibbs_offer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."dibbs_offer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_requests" ADD CONSTRAINT "dibbs_offer_requests_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_requests" ADD CONSTRAINT "dibbs_offer_requests_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_requests" ADD CONSTRAINT "dibbs_offer_requests_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_requests" ADD CONSTRAINT "dibbs_offer_requests_assigned_staff_id_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dibbs_offer_requests" ADD CONSTRAINT "dibbs_offer_requests_meetup_spot_id_meetup_spots_id_fk" FOREIGN KEY ("meetup_spot_id") REFERENCES "public"."meetup_spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dibbs_offer_events_request_idx" ON "dibbs_offer_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "dibbs_offer_media_request_idx" ON "dibbs_offer_media" USING btree ("request_id","sort_order");--> statement-breakpoint
CREATE INDEX "dibbs_offer_media_uploader_idx" ON "dibbs_offer_media" USING btree ("uploader_id","created_at");--> statement-breakpoint
CREATE INDEX "dibbs_offer_notifications_due_idx" ON "dibbs_offer_notifications" USING btree ("status","send_after");--> statement-breakpoint
CREATE UNIQUE INDEX "dibbs_offer_requests_client_uq" ON "dibbs_offer_requests" USING btree ("seller_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dibbs_offer_requests_open_listing_uq" ON "dibbs_offer_requests" USING btree ("listing_id") WHERE "dibbs_offer_requests"."listing_id" is not null and "dibbs_offer_requests"."status" not in ('completed','declined','seller_declined','final_declined','withdrawn','expired','closed');--> statement-breakpoint
CREATE INDEX "dibbs_offer_requests_seller_idx" ON "dibbs_offer_requests" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "dibbs_offer_requests_status_idx" ON "dibbs_offer_requests" USING btree ("status","created_at");