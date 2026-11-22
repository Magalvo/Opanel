ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('none', 'low', 'medium', 'high', 'urgent'));