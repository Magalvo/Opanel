// The add-on's end-to-end run (WS-093) uses the app's end-to-end database and secrets
// (tests/e2e/environment.ts) on its own port, so it never tests a server the app's own
// end-to-end run started.

export const ADDON_PORT = 3200;

export const ADDON_BASE_URL = `http://localhost:${String(ADDON_PORT)}`;
