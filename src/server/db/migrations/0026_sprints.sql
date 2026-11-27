CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_points" numeric(7, 1),
	"completed_points" numeric(7, 1),
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_state_check" CHECK ("sprints"."state" in ('planned', 'active', 'completed')),
	CONSTRAINT "sprints_dates_ordered" CHECK ("sprints"."end_date" >= "sprints"."start_date"),
	CONSTRAINT "sprints_version_positive" CHECK ("sprints"."version" >= 1),
	CONSTRAINT "sprints_completed_check" CHECK (case when "sprints"."state" = 'completed'
        then "sprints"."completed_at" is not null and "sprints"."total_points" is not null and "sprints"."completed_points" is not null
        else "sprints"."completed_at" is null and "sprints"."total_points" is null and "sprints"."completed_points" is null end),
	CONSTRAINT "sprints_started_check" CHECK (("sprints"."started_at" is null) = ("sprints"."state" = 'planned'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sprints_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_active_idx" ON "sprints" USING btree ("project_id") WHERE "sprints"."state" = 'active';--> statement-breakpoint
CREATE INDEX "sprints_project_order_idx" ON "sprints" USING btree ("project_id","start_date","created_at","id");