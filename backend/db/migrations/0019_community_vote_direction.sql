ALTER TABLE "community_comment_votes" ADD COLUMN "value" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_post_votes" ADD COLUMN "value" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_comment_votes" ADD CONSTRAINT "community_comment_votes_value_check" CHECK ("community_comment_votes"."value" in (1, -1));--> statement-breakpoint
ALTER TABLE "community_post_votes" ADD CONSTRAINT "community_post_votes_value_check" CHECK ("community_post_votes"."value" in (1, -1));