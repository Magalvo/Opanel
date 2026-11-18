-- The app checks at start-up that the database's schema is the one it was built for (WS-064): it reads the migrations' table, and only that, in the drizzle schema.
GRANT USAGE ON SCHEMA drizzle TO opanel_app;--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO opanel_app;
