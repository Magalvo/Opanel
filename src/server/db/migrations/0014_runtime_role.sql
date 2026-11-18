-- The runtime role (WS-063, doc 0006 section 5): what the app may do, and nothing more. The app connects as any login role that is a member of opanel_app; the migrating role owns the schema.
DO $$ BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opanel_app') THEN
		CREATE ROLE opanel_app NOLOGIN;
	END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO opanel_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO opanel_app;--> statement-breakpoint
-- Append-only (migrations 0003, 0009 and 0012): the app may read and add rows, never change them.
REVOKE UPDATE, DELETE ON "audit_log", "task_events", "comments" FROM opanel_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO opanel_app;--> statement-breakpoint
-- Tables and sequences that later migrations create get the same rights. A migration that creates an append-only table revokes UPDATE and DELETE on it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opanel_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO opanel_app;
