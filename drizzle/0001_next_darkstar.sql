CREATE TABLE "schedule_template_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"time" varchar(5) NOT NULL,
	"teacher_id" integer,
	"class_type_id" integer,
	"room" varchar(60),
	"capacity" integer DEFAULT 20 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"studio_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_types" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_template_slots" ADD CONSTRAINT "schedule_template_slots_template_id_schedule_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."schedule_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_template_slots" ADD CONSTRAINT "schedule_template_slots_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_template_slots" ADD CONSTRAINT "schedule_template_slots_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;