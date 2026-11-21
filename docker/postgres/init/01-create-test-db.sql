-- Runs once, when the data volume is first initialised. The test harnesses also create
-- any missing test database themselves, for example a worktree's own (WS-095), so this
-- file only saves them that step on a fresh volume.
-- The test harnesses refuse any database whose name does not end in _test.

-- Integration tests (Vitest). Emptied before every test.
CREATE DATABASE opanel_test OWNER opanel;

-- End-to-end tests (Playwright). Used by the app that the browser tests drive.
CREATE DATABASE opanel_e2e_test OWNER opanel;
