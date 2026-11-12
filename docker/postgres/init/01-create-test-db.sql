-- Runs once, when the data volume is first initialised. After changing this file,
-- recreate the volume: `docker compose down -v && docker compose up -d`.
-- The test harnesses refuse any database whose name does not end in _test.

-- Integration tests (Vitest). Emptied before every test.
CREATE DATABASE opanel_test OWNER opanel;

-- End-to-end tests (Playwright). Used by the app that the browser tests drive.
CREATE DATABASE opanel_e2e_test OWNER opanel;
