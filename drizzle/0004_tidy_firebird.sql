CREATE TYPE "public"."bill_frequency" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('unpaid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('booking', 'membership');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"guest_id" integer,
	"booking_id" integer,
	"membership_id" integer,
	"purpose" "payment_purpose" NOT NULL,
	"provider" varchar(30) DEFAULT 'iyzico' NOT NULL,
	"provider_conversation_id" varchar(120),
	"provider_token" varchar(120),
	"provider_payment_id" varchar(120),
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"settled_manually" boolean DEFAULT false NOT NULL,
	"settled_on" date,
	"raw_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"vendor_name" varchar(120) NOT NULL,
	"category" varchar(60) DEFAULT 'other' NOT NULL,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"status" "bill_status" DEFAULT 'unpaid' NOT NULL,
	"paid_on" date,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_frequency" "bill_frequency",
	"recurrence_series_id" integer,
	"entered_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_recurrence_series_id_vendor_bills_id_fk" FOREIGN KEY ("recurrence_series_id") REFERENCES "public"."vendor_bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;