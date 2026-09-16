CREATE TABLE "geocode_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"display_name" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "spot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "center_lat" double precision DEFAULT 32.2319 NOT NULL;--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "center_lng" double precision DEFAULT -110.9501 NOT NULL;--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "meetup_radius_meters" integer DEFAULT 3219 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "custom_address" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "custom_lat" double precision;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "custom_lng" double precision;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_spot_xor_custom" CHECK ((
        "reservations"."spot_id" is not null
        and "reservations"."custom_address" is null and "reservations"."custom_lat" is null and "reservations"."custom_lng" is null
      ) or (
        "reservations"."spot_id" is null
        and "reservations"."custom_address" is not null and "reservations"."custom_lat" is not null and "reservations"."custom_lng" is not null
      ));