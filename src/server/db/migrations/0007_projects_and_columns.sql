CREATE TABLE "columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"position" text collate "C" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "columns_category_check" CHECK ("columns"."category" in ('todo', 'in_progress', 'done')),
	CONSTRAINT "columns_version_positive" CHECK ("columns"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"next_task_number" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_key_unique" UNIQUE("key"),
	CONSTRAINT "projects_key_format" CHECK ("projects"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "projects_version_positive" CHECK ("projects"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "columns" ADD CONSTRAINT "columns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "columns_project_position_idx" ON "columns" USING btree ("project_id","position");