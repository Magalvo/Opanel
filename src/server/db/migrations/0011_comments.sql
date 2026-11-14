CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text DEFAULT 'user' NOT NULL,
	"author_account_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_kind_check" CHECK ("comments"."kind" in ('user')),
	CONSTRAINT "comments_body_length" CHECK (char_length("comments"."body") between 1 and 10000),
	CONSTRAINT "comments_user_has_author" CHECK ("comments"."kind" <> 'user' or "comments"."author_account_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_account_id_accounts_id_fk" FOREIGN KEY ("author_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_task_idx" ON "comments" USING btree ("task_id","created_at","id");--> statement-breakpoint
-- Comments are never edited or deleted (WT-03 question 2, WS-034), like task_events.
CREATE FUNCTION comments_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'comments is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER comments_append_only
	BEFORE UPDATE OR DELETE ON "comments"
	FOR EACH ROW EXECUTE FUNCTION comments_reject_change();
