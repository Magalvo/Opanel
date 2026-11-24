ALTER TABLE "tasks" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', description), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "tasks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_reporter_idx" ON "tasks" USING btree ("reporter_account_id");