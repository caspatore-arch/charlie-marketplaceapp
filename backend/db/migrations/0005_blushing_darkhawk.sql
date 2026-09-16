CREATE TYPE "public"."sale_type" AS ENUM('fixed', 'auction');--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "sale_type" "sale_type" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "start_price_cents" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "buyout_price_cents" integer;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_listing_amount_idx" ON "bids" USING btree ("listing_id","amount_cents" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bids_bidder_idx" ON "bids" USING btree ("bidder_id");--> statement-breakpoint
CREATE INDEX "listings_sale_type_expires_idx" ON "listings" USING btree ("sale_type","expires_at");