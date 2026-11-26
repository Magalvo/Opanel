ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id") WHERE "tasks"."parent_task_id" is not null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_not_self_check" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id");