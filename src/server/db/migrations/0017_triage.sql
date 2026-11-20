CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_account_id" uuid NOT NULL,
	"account_kind" text DEFAULT 'agent' NOT NULL,
	"task_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"origin_layer" text NOT NULL,
	"confidence" real,
	"severity" text NOT NULL,
	"fingerprint" text NOT NULL,
	"run_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_reports_account_kind_check" CHECK ("bug_reports"."account_kind" = 'agent'),
	CONSTRAINT "bug_reports_outcome_check" CHECK ("bug_reports"."outcome" in ('created', 'deduplicated')),
	CONSTRAINT "bug_reports_origin_layer_check" CHECK ("bug_reports"."origin_layer" in ('frontend', 'api', 'backend', 'unknown')),
	CONSTRAINT "bug_reports_confidence_check" CHECK ("bug_reports"."confidence" is null or "bug_reports"."confidence" between 0 and 1),
	CONSTRAINT "bug_reports_severity_check" CHECK ("bug_reports"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "bug_reports_fingerprint_check" CHECK (char_length("bug_reports"."fingerprint") between 1 and 128),
	CONSTRAINT "bug_reports_run_id_check" CHECK ("bug_reports"."run_id" is null or char_length("bug_reports"."run_id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"project_id" uuid NOT NULL,
	"origin_layer" text NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "routing_rules_project_id_origin_layer_pk" PRIMARY KEY("project_id","origin_layer"),
	CONSTRAINT "routing_rules_origin_layer_check" CHECK ("routing_rules"."origin_layer" in ('frontend', 'api', 'backend'))
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"from_task_id" uuid NOT NULL,
	"to_task_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_links_from_task_id_to_task_id_type_pk" PRIMARY KEY("from_task_id","to_task_id","type"),
	CONSTRAINT "task_links_type_check" CHECK ("task_links"."type" in ('regression_of')),
	CONSTRAINT "task_links_not_self_check" CHECK ("task_links"."from_task_id" <> "task_links"."to_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_events" DROP CONSTRAINT "task_events_type_check";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "triage_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "occurrences" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_agent_account_fk" FOREIGN KEY ("agent_account_id","account_kind") REFERENCES "public"."accounts"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_from_task_id_tasks_id_fk" FOREIGN KEY ("from_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_to_task_id_tasks_id_fk" FOREIGN KEY ("to_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_reports_task_idx" ON "bug_reports" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "bug_reports_project_idx" ON "bug_reports" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "routing_rules_team_idx" ON "routing_rules" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "task_links_to_task_idx" ON "task_links" USING btree ("to_task_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_triage_team_id_teams_id_fk" FOREIGN KEY ("triage_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_triage_team_idx" ON "projects" USING btree ("triage_team_id");--> statement-breakpoint
CREATE INDEX "tasks_project_fingerprint_idx" ON "tasks" USING btree ("project_id","fingerprint") WHERE "tasks"."fingerprint" is not null;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_type_check" CHECK ("task_events"."type" in ('created', 'field_changed', 'moved', 'deleted', 'restored', 'commented', 'reported_again'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_severity_check" CHECK ("tasks"."severity" is null or ("tasks"."severity" in ('low', 'medium', 'high', 'critical') and "tasks"."type" = 'bug'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_fingerprint_check" CHECK ("tasks"."fingerprint" is null or char_length("tasks"."fingerprint") between 1 and 128);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_occurrences_check" CHECK ("tasks"."occurrences" >= 0);