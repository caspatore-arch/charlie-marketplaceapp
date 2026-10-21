ALTER TABLE "offers" ADD COLUMN "proposed_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "proposed_spot_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_proposed_spot_id_meetup_spots_id_fk" FOREIGN KEY ("proposed_spot_id") REFERENCES "public"."meetup_spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_proposal_both_or_neither" CHECK (("offers"."proposed_starts_at" is null) = ("offers"."proposed_spot_id" is null));