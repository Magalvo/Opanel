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
