-- Dibbs workstreams: offers replace auctions, rolling-24h booking, community
-- posts, phone sign-in, transactional SMS outbox.
--
-- NON-DESTRUCTIVE. No auction listing, bid, reservation or payment row is
-- changed or deleted here. Auctions are retired in code instead: new auctions
-- and new bids are refused, and listings that were already auctions settle at
-- their original end time (every auction ran at most 24h, so the legacy path
-- drains on its own within a day). See docs/CONTRACT.md "Auctions retired".
--
-- PRE-CHECK for a hosted database: the two partial unique indexes on
-- reservations(seller_id|buyer_id, starts_at) WHERE status='accepted' fail if
-- someone already holds two accepted meetups at the identical instant. Run
--   select seller_id, starts_at, count(*) from reservations
--   where status='accepted' group by 1,2 having count(*) > 1;
-- first and resolve any rows by hand (never automatically).
CREATE TYPE "public"."community_post_kind" AS ENUM('buying', 'selling');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'booked');--> statement-breakpoint
CREATE TYPE "public"."sms_kind" AS ENUM('listing_posted', 'booking_confirmed', 'meetup_reminder');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('scheduled', 'sending', 'sent', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "community_post_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"asking_price_cents" integer NOT NULL,
	"message" text,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"close_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_amount_positive" CHECK ("offers"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "phone_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"status" "reservation_status" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"spot_id" uuid,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" "sms_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"body" text NOT NULL,
	"status" "sms_status" DEFAULT 'scheduled' NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"reservation_id" uuid,
	"listing_id" uuid,
	"meetup_starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sms_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "offers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "target_post_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_removed_by_id_users_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_codes" ADD CONSTRAINT "phone_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_posts_feed_idx" ON "community_posts" USING btree ("campus_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "community_posts_author_idx" ON "community_posts" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_accepted_per_listing" ON "offers" USING btree ("listing_id") WHERE "offers"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_open_per_buyer" ON "offers" USING btree ("listing_id","buyer_id") WHERE "offers"."status" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "offers_seller_idx" ON "offers" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "offers_buyer_idx" ON "offers" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "phone_codes_phone_idx" ON "phone_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "reservation_events_reservation_idx" ON "reservation_events" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_due_idx" ON "sms_messages" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "sms_messages_reservation_idx" ON "sms_messages" USING btree ("reservation_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_post_id_community_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_seller_slot_uq" ON "reservations" USING btree ("seller_id","starts_at") WHERE "reservations"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_buyer_slot_uq" ON "reservations" USING btree ("buyer_id","starts_at") WHERE "reservations"."status" = 'accepted';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");--> statement-breakpoint
-- Seed the durable history with each existing reservation's current state.
INSERT INTO "reservation_events" ("reservation_id", "actor_id", "kind", "status", "starts_at", "spot_id", "price_cents", "created_at")
SELECT "id", NULL, 'imported', "status", "starts_at", "spot_id", "price_cents", "updated_at" FROM "reservations";
