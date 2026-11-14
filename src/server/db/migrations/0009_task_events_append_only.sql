-- A task's history is append-only (canonical doc 0003 section 9, WS-030), like audit_log.
CREATE FUNCTION task_events_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'task_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_events_append_only
	BEFORE UPDATE OR DELETE ON "task_events"
	FOR EACH ROW EXECUTE FUNCTION task_events_reject_change();
