// Runs in every integration test worker, before its test file.
import { afterAll, beforeEach } from "vitest";

import { closeDb } from "@/server/db/client";
import { resetDatabase } from "@/server/db/testing";
import { applyWorktreeTestDatabase } from "@/server/db/worktree";
import { loadEnvFiles } from "@/server/env-files";

loadEnvFiles();
// The same worktree database as the global setup (WS-095).
applyWorktreeTestDatabase(process.env);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});
