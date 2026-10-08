CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"code" varchar(40) NOT NULL,
	"discount_type" "coupon_type" NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"expires_on" date,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_waivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"guest_id" integer NOT NULL,
	"signed_name" varchar(120) NOT NULL,
	"health_notes" text,
	"emergency_contact" varchar(200),
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_token" varchar(64);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "coupon_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "discount_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "studios" ADD COLUMN "cancel_window_hours" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_waivers" ADD CONSTRAINT "guest_waivers_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_waivers" ADD CONSTRAINT "guest_waivers_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_studio_code_unique" ON "coupons" USING btree ("studio_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_studio_guest_unique" ON "guest_waivers" USING btree ("studio_id","guest_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancel_token_unique" UNIQUE("cancel_token");