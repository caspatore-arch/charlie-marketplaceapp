CREATE TABLE "listing_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "community_comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_comments" ADD CONSTRAINT "listing_comments_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_comments" ADD CONSTRAINT "listing_comments_parent_id_listing_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."listing_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_comments" ADD CONSTRAINT "listing_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_comments" ADD CONSTRAINT "listing_comments_removed_by_id_users_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_comments_listing_idx" ON "listing_comments" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_comments_parent_idx" ON "listing_comments" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_parent_id_community_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."community_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_comments_parent_idx" ON "community_comments" USING btree ("parent_id");