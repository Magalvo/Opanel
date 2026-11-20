-- Bug reports are kept as sent, never edited or deleted (WT-06 decision 11, WS-086), like
-- task_events and comments. The runtime role loses UPDATE and DELETE on it too (WS-063).
CREATE FUNCTION bug_reports_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'bug_reports is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bug_reports_append_only
	BEFORE UPDATE OR DELETE ON "bug_reports"
	FOR EACH ROW EXECUTE FUNCTION bug_reports_reject_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "bug_reports" FROM opanel_app;
