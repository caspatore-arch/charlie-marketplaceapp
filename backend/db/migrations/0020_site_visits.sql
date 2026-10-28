CREATE TABLE "site_visits" (
	"day" text NOT NULL,
	"platform" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_visits_day_platform_pk" PRIMARY KEY("day","platform")
);
