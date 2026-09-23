CREATE TABLE "report_share_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"report_type" varchar(30) DEFAULT 'pnl' NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "ics_token" varchar(64);--> statement-breakpoint
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_ics_token_unique" UNIQUE("ics_token");