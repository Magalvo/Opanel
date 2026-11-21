// The add-on's end-to-end run (WS-093) uses the app's end-to-end database and secrets
// (tests/e2e/environment.ts) on its own port, so it never tests a server the app's own
// end-to-end run started. Its port: OPANEL_ADDON_E2E_PORT when set, else 3200 in the main
// checkout and 21000-21999 in a linked worktree, from its ID (WS-095).
import { e2ePort, WORKTREE_ID } from "../../../tests/e2e/environment";

export const ADDON_PORT_VARIABLE = "OPANEL_ADDON_E2E_PORT";

export const ADDON_PORT = e2ePort(
  { variable: ADDON_PORT_VARIABLE, fallback: 3200, base: 21000 },
  WORKTREE_ID,
  process.env,
);

export const ADDON_BASE_URL = `http://localhost:${String(ADDON_PORT)}`;
